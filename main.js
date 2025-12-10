/* global rive */

const canvas = document.getElementById('riveCanvas');
const inputsContainer = document.getElementById('inputsContainer');
const reloadBtn = document.getElementById('reloadBtn');
const filePathInput = document.getElementById('filePath');
const fileChooser = document.getElementById('fileChooser');
const smNameInput = document.getElementById('smName');
const artboardSelect = document.getElementById('artboardSelect');
const smSelect = document.getElementById('smSelect');
const libraryFilesContainer = document.getElementById('libraryFiles');

// Library files from the rives folder
const LIBRARY_FILES = [
  { name: 'Megazord', path: './rives/megazord_v1.riv' },
];

/** @type {import('@rive-app/canvas').Rive | null} */
let riveInstance = null;
let currentSMName = null;
let currentArtboardName = null;
let inputNameToController = new Map();
let selectedRivBuffer = null;
let currentLibraryFile = null;

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
  
  // Log Rive version info
  console.log('Rive Runtime Version:', RiveNS.RuntimeVersion || RiveNS.VERSION || 'Unknown');
  
  const commonCtorOpts = {
    canvas,
    autoplay: true,
    autoBind: true,  // Enable automatic ViewModel binding!
    layout: new RiveNS.Layout({
      fit: RiveNS.Fit.Contain,
      alignment: RiveNS.Alignment.Center,
    }),
    onLoadError: (err) => {
      console.error('=== Rive Load Error ===');
      console.error('Error:', err);
      console.error('File:', src || 'Buffer');
      inputsContainer.innerHTML = '<div class="pill" style="background:#ff5555;color:#fff;">Error loading file: ' + err + '</div>';
    }
  };

  const firstCtorOpts = selectedRivBuffer
    ? { ...commonCtorOpts, buffer: selectedRivBuffer, artboard: currentArtboardName || 'Artboard', stateMachines: desiredSM || 'State Machine 1' }
    : { ...commonCtorOpts, src, artboard: currentArtboardName || 'Artboard', stateMachines: desiredSM || 'State Machine 1' };

  riveInstance = new RiveCtor({
    ...firstCtorOpts,
    onLoad: () => {
      console.log('Rive loaded successfully');
      // Ensure canvas internal surface matches CSS size
      try { riveInstance.resizeDrawingSurfaceToCanvas(); } catch (_) {}
      window.addEventListener('resize', () => {
        if (riveInstance) {
          try { riveInstance.resizeDrawingSurfaceToCanvas(); } catch (_) {}
        }
      });
      
      // Debug: Log available artboards and state machines
      try {
        const artboards = typeof riveInstance.artboardNames === 'function' ? riveInstance.artboardNames() : (riveInstance.artboardNames || []);
        const stateMachines = typeof riveInstance.stateMachineNames === 'function' ? riveInstance.stateMachineNames() : (riveInstance.stateMachineNames || []);
        console.log('Available artboards:', artboards);
        console.log('Available state machines:', stateMachines);
      } catch (e) {
        console.log('Could not enumerate artboards/state machines:', e);
      }
      
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

      // Debug: Log the riveInstance to see what's available
      console.log('=== Rive Instance Debug ===');
      console.log('Rive Instance:', riveInstance);
      console.log('State Machine Name:', smName);
      
      // Make sure state machine is playing
      try {
        riveInstance.play(smName);
        console.log('✓ State Machine started:', smName);
      } catch (e) {
        console.log('Error starting state machine:', e.message);
      }
      
      // Check for ViewModel Instance (new API from tutorial)
      if (riveInstance.viewModelInstance) {
        console.log('✓ viewModelInstance found!');
        const vmi = riveInstance.viewModelInstance;
        console.log('ViewModel Instance:', vmi);
        
        // Try to access the boolean property "asd"
        try {
          const asdProp = vmi.boolean('asd');
          if (asdProp) {
            console.log('✓ Found boolean property "asd"');
            console.log('  Current value:', asdProp.value);
            
            // Create a control for it
            const fakeInput = {
              name: 'asd',
              type: 'boolean',
              value: asdProp.value,
              setValue: (val) => {
                console.log('=== TOGGLING ASD ===');
                console.log('Setting asd from', asdProp.value, 'to', val);
                asdProp.value = val;
                console.log('Set asd to:', val);
                
                // Verify it was set
                setTimeout(() => {
                  console.log('Verified asd is now:', vmi.boolean('asd').value);
                  console.log('Is playing:', riveInstance.isPlaying);
                  console.log('Animation is responding! ✓');
                }, 10);
                
                // Try to ensure state machine is playing
                if (!riveInstance.isPlaying) {
                  console.log('State machine not playing, starting it...');
                  riveInstance.play();
                }
                
                // Force a redraw
                try {
                  riveInstance.resizeDrawingSurfaceToCanvas();
                } catch (e) {}
              }
            };
            
            // Build the UI immediately with this input
            buildControls([fakeInput]);
            return; // Exit early since we found the ViewModel input
          }
        } catch (e) {
          console.log('Error accessing boolean "asd":', e.message);
        }
      } else {
        console.log('✗ No viewModelInstance found');
      }
      
      // Check for artboard
      if (riveInstance.artboard) {
        console.log('Artboard:', riveInstance.artboard);
      }

      // Gather inputs from State Machine
      let inputs = riveInstance.stateMachineInputs(smName) || [];
      console.log('State Machine Inputs:', inputs);
      console.log('State Machine Inputs length:', inputs.length);
      console.log('State Machine Inputs details:', inputs.map(i => ({
        name: i.name,
        type: i.type,
        value: i.value
      })));
      
      // Log final input count
      console.log('=== TOTAL INPUTS FOUND:', inputs.length, '===');
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

// Populate library files
function populateLibraryFiles() {
  libraryFilesContainer.innerHTML = '';
  LIBRARY_FILES.forEach((file, index) => {
    const btn = document.createElement('button');
    btn.className = 'library-file';
    btn.textContent = file.name;
    btn.dataset.path = file.path;
    btn.dataset.index = index;
    btn.addEventListener('click', () => selectLibraryFile(file, btn));
    libraryFilesContainer.appendChild(btn);
  });
}

function selectLibraryFile(file, btn) {
  // Clear any uploaded file buffer
  selectedRivBuffer = null;
  currentLibraryFile = file.path;
  
  // Update UI
  document.querySelectorAll('.library-file').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filePathInput.value = file.path;
  fileChooser.value = '';
  
  // Load the file
  loadRive();
}

// Wire UI
reloadBtn.addEventListener('click', loadRive);

// Local file chooser avoids CORS by providing ArrayBuffer directly to the Rive runtime
async function handleRiveFile(file) {
  if (!file) return;
  try {
    selectedRivBuffer = await file.arrayBuffer();
    currentLibraryFile = null;
    
    // Clear library selection
    document.querySelectorAll('.library-file').forEach(b => b.classList.remove('active'));
    
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
  populateLibraryFiles();
  
  // Auto-select first library file
  if (LIBRARY_FILES.length > 0) {
    const firstBtn = libraryFilesContainer.querySelector('.library-file');
    if (firstBtn) {
      selectLibraryFile(LIBRARY_FILES[0], firstBtn);
    }
  }
  
  artboardSelect.addEventListener('change', () => loadRive());
  smSelect.addEventListener('change', () => loadRive());
});


