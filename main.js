/* global rive */

const canvas = document.getElementById('riveCanvas');
const inputsContainer = document.getElementById('inputsContainer');
const loadBtn = document.getElementById('loadBtn');
const reloadBtn = document.getElementById('reloadBtn');
const filePathInput = document.getElementById('filePath');
const fileChooser = document.getElementById('fileChooser');
const smNameInput = document.getElementById('smName');
const artboardSelect = document.getElementById('artboardSelect');
const smSelect = document.getElementById('smSelect');

/** @type {import('@rive-app/canvas').Rive | null} */
let riveInstance = null;
let currentSMName = null;
let currentArtboardName = null;
let inputNameToController = new Map();
let selectedRivBuffer = null;

function disposeRive() {
  if (riveInstance) {
    riveInstance.stop();
    riveInstance.cleanup();
    riveInstance = null;
  }
  inputNameToController.clear();
}

function detectFirstStateMachine(rive) {
  try {
    const list = typeof rive.stateMachineNames === 'function'
      ? rive.stateMachineNames()
      : (Array.isArray(rive.stateMachineNames) ? rive.stateMachineNames : []);
    if (list && list.length) return list[0];
  } catch (_) {}
  // fallback for some builds
  try {
    if (rive._runtime && rive._runtime.stateMachineNames) {
      const arr = rive._runtime.stateMachineNames();
      if (arr && arr.length) return arr[0];
    }
  } catch (_) {}
  return null;
}

function populateSelectors(rive, chosenArtboard, chosenSM) {
  try {
    const artboardNames = typeof rive.artboardNames === 'function' ? rive.artboardNames() : (rive.artboardNames || []);
    artboardSelect.innerHTML = '';
    for (const name of artboardNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (chosenArtboard && chosenArtboard === name) opt.selected = true;
      artboardSelect.appendChild(opt);
    }
    const smNames = typeof rive.stateMachineNames === 'function' ? rive.stateMachineNames() : (rive.stateMachineNames || []);
    smSelect.innerHTML = '';
    for (const name of smNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (chosenSM && chosenSM === name) opt.selected = true;
      smSelect.appendChild(opt);
    }
  } catch (_) {}
}

function makeToggleRow(name, initial, onChange) {
  const row = document.createElement('div');
  row.className = 'input-row';
  const label = document.createElement('label');
  label.textContent = name;
  const wrapper = document.createElement('label');
  wrapper.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!initial;
  const knob = document.createElement('span');
  knob.className = 'knob';
  wrapper.appendChild(input);
  wrapper.appendChild(knob);
  wrapper.addEventListener('click', (e) => {
    e.preventDefault();
    input.checked = !input.checked;
    onChange(input.checked);
  });
  row.appendChild(label);
  row.appendChild(wrapper);
  return row;
}

function makeTriggerRow(name, onFire) {
  const row = document.createElement('div');
  row.className = 'input-row';
  const label = document.createElement('label');
  label.textContent = name;
  const btn = document.createElement('button');
  btn.className = 'btn fire-btn';
  btn.textContent = 'Fire';
  btn.addEventListener('click', () => onFire());
  row.appendChild(label);
  row.appendChild(btn);
  return row;
}

function makeNumberRow(name, initial, onChange) {
  const row = document.createElement('div');
  row.className = 'input-row';
  const label = document.createElement('label');
  label.textContent = name;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'number-input';
  input.value = String(initial ?? 0);
  input.addEventListener('input', () => onChange(parseInt(input.value || '0', 10)));
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function buildControls(controllers) {
  inputsContainer.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const c of controllers) {
    const { name, type, setValue, fire, value } = c;
    if (type === 'boolean') {
      frag.appendChild(makeToggleRow(name, value, setValue));
    } else if (type === 'trigger') {
      frag.appendChild(makeTriggerRow(name, fire));
    } else if (type === 'number') {
      frag.appendChild(makeNumberRow(name, value, setValue));
    }
  }
  inputsContainer.appendChild(frag);
}

async function loadRive() {
  disposeRive();
  const src = filePathInput.value.trim();
  const desiredSM = smNameInput.value.trim() || null;

  const RiveNS = window.rive || window;
  const RiveCtor = window.Rive || (RiveNS && RiveNS.Rive);
  if (!RiveCtor) {
    console.warn('Rive runtime not ready, retrying...');
    setTimeout(loadRive, 80);
    return;
  }
  const commonCtorOpts = {
    canvas,
    autoplay: true,
    layout: new RiveNS.Layout({
      fit: RiveNS.Fit.Contain,
      alignment: RiveNS.Alignment.Center,
    }),
  };

  const firstCtorOpts = selectedRivBuffer
    ? { ...commonCtorOpts, buffer: selectedRivBuffer }
    : { ...commonCtorOpts, src };

  riveInstance = new RiveCtor({
    ...firstCtorOpts,
    onLoad: () => {
      // Ensure canvas internal surface matches CSS size
      try { riveInstance.resizeDrawingSurfaceToCanvas(); } catch (_) {}
      window.addEventListener('resize', () => {
        if (riveInstance) {
          try { riveInstance.resizeDrawingSurfaceToCanvas(); } catch (_) {}
        }
      });
      populateSelectors(riveInstance, currentArtboardName, desiredSM);
      const smName = desiredSM || smSelect.value || detectFirstStateMachine(riveInstance);
      if (!smName) {
        console.warn('No state machine found');
        return;
      }
      currentSMName = smName;
      smNameInput.placeholder = smName;
      currentArtboardName = artboardSelect.value || currentArtboardName;

      riveInstance.play(smName);

      // Gather inputs
      let inputs = riveInstance.stateMachineInputs(smName) || [];
      // If empty, try re-instantiating with stateMachines prebound (some builds require this)
      if (!inputs || inputs.length === 0) {
        const prevSm = smName;
        const prevLayout = new RiveNS.Layout({
          fit: RiveNS.Fit.Contain,
          alignment: RiveNS.Alignment.Center,
        });
        disposeRive();
        const secondCtorBase = selectedRivBuffer
          ? { buffer: selectedRivBuffer }
          : { src };
        riveInstance = new RiveCtor({
          ...secondCtorBase,
          canvas,
          autoplay: true,
          stateMachines: prevSm,
          artboard: currentArtboardName || undefined,
          layout: prevLayout,
          onLoad: () => {
            try { riveInstance.resizeDrawingSurfaceToCanvas(); } catch (_) {}
            riveInstance.play(prevSm);
            const retryInputs = riveInstance.stateMachineInputs(prevSm) || [];
            buildFromInputs(retryInputs);
          },
        });
        return;
      }

      buildFromInputs(inputs);
    },
  });

  function buildFromInputs(inputs) {
      const controllers = [];
      inputNameToController.clear();

      const IT = RiveNS && RiveNS.InputType ? RiveNS.InputType : {};
      for (const input of inputs) {
        const { name } = input;
        const type = input.type;
        // Type detection: support both old (0,1,2) and new (56,58,59) enum values
        const isBool = type === IT.Boolean || type === 'boolean' || type === 0 || type === 59;
        const isTrig = type === IT.Trigger || type === 'trigger' || type === 2 || type === 58;
        const isNum = type === IT.Number || type === 'number' || type === 1 || type === 56;
        if (isBool) {
          const controller = {
            name,
            type: 'boolean',
            value: input.value,
            setValue: (val) => input.value = !!val,
          };
          inputNameToController.set(name, controller);
          controllers.push(controller);
        } else if (isTrig) {
          const controller = {
            name,
            type: 'trigger',
            fire: () => input.fire(),
          };
          inputNameToController.set(name, controller);
          controllers.push(controller);
        } else if (isNum) {
          const controller = {
            name,
            type: 'number',
            value: input.value ?? 0,
            setValue: (val) => input.value = Number.isFinite(val) ? val : 0,
          };
          inputNameToController.set(name, controller);
          controllers.push(controller);
        }
      }

      // Ensure integer field named bg_color appears as number control even if not detected
      if (!inputNameToController.has('bg_color')) {
        const maybe = inputs.find(i => i.name === 'bg_color');
        if (maybe) {
          const controller = {
            name: 'bg_color',
            type: 'number',
            value: maybe.value ?? 0,
            setValue: (val) => maybe.value = Number.isFinite(val) ? val : 0,
          };
          inputNameToController.set('bg_color', controller);
          controllers.push(controller);
        }
      }

      // Sort controls: booleans, triggers, numbers; keep original order within type
      const order = { boolean: 0, trigger: 1, number: 2 };
      controllers.sort((a, b) => (order[a.type] - order[b.type]) || a.name.localeCompare(b.name));
      if (controllers.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'pill';
        msg.textContent = 'No inputs found for this state machine';
        inputsContainer.innerHTML = '';
        inputsContainer.appendChild(msg);
      } else {
        buildControls(controllers);
      }
  }
}

// Wire UI
loadBtn.addEventListener('click', loadRive);
reloadBtn.addEventListener('click', loadRive);

// Local file chooser avoids CORS by providing ArrayBuffer directly to the Rive runtime
async function handleRiveFile(file) {
  if (!file) return;
  try {
    selectedRivBuffer = await file.arrayBuffer();
    filePathInput.value = file.name;
    await loadRive();
  } catch (err) {
    console.error('Failed to read .riv file:', err);
  }
}

fileChooser.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  await handleRiveFile(file);
});

// Drag and drop support
const dropZone = document.getElementById('dropZone');
const dropOverlay = document.getElementById('dropOverlay');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
});

['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    dropOverlay.classList.add('active');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => {
    dropOverlay.classList.remove('active');
  });
});

dropZone.addEventListener('drop', async (e) => {
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    if (file.name.endsWith('.riv')) {
      await handleRiveFile(file);
    } else {
      console.warn('Please drop a .riv file');
    }
  }
});

// Auto-load on first paint
window.addEventListener('DOMContentLoaded', () => {
  loadRive();
  artboardSelect.addEventListener('change', () => loadRive());
  smSelect.addEventListener('change', () => loadRive());
});


