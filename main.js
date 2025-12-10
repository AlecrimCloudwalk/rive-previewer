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

// Extract potential property names from .riv file binary
// Rive files contain property names as readable strings
function extractPropertyNamesFromRiv(buffer) {
  const names = new Set();
  const bytes = new Uint8Array(buffer);
  
  // Look for readable ASCII strings (property names are usually 2-30 chars, camelCase or snake_case)
  let currentString = '';
  const minLength = 2;
  const maxLength = 50;
  
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    // Check if it's a printable ASCII character (letters, numbers, underscore)
    if ((byte >= 65 && byte <= 90) ||  // A-Z
        (byte >= 97 && byte <= 122) || // a-z
        (byte >= 48 && byte <= 57) ||  // 0-9
        byte === 95) {                  // underscore
      currentString += String.fromCharCode(byte);
    } else {
      // End of string - save if valid length
      if (currentString.length >= minLength && currentString.length <= maxLength) {
        // Filter out common non-property strings
        const lowerStr = currentString.toLowerCase();
        const blacklist = ['rive', 'main', 'artboard', 'state', 'machine', 'animation', 
                          'layer', 'shape', 'fill', 'stroke', 'path', 'bone', 'mesh',
                          'constraint', 'clipping', 'blend', 'group', 'node', 'key',
                          'frame', 'linear', 'cubic', 'hold', 'elastic', 'bounce',
                          'ease', 'null', 'true', 'false', 'undefined', 'function',
                          'object', 'array', 'string', 'number', 'boolean', 'trigger',
                          'enum', 'color', 'instance', 'default', 'constructor'];
        
        // Check if it looks like a valid property name (starts with letter, camelCase or has meaning)
        if (!blacklist.includes(lowerStr) && 
            /^[a-zA-Z][a-zA-Z0-9_]*$/.test(currentString) &&
            currentString.length <= 30) {
          // Prioritize names that look like properties (camelCase, specific patterns)
          if (/^(is|has|can|should|enable|disable|show|hide|toggle|on|off)[A-Z]/.test(currentString) ||
              /^[a-z]+[A-Z]/.test(currentString) || // camelCase
              /^[a-z]{2,}$/.test(currentString)) {  // simple lowercase
            names.add(currentString);
          }
        }
      }
      currentString = '';
    }
  }
  
  // Handle last string if file doesn't end with non-ASCII
  if (currentString.length >= minLength && currentString.length <= maxLength) {
    if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(currentString)) {
      names.add(currentString);
    }
  }
  
  return Array.from(names);
}

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
    } else if (type === 'string') {
      frag.appendChild(makeStringRow(name, value, setValue));
    } else if (type === 'color') {
      frag.appendChild(makeColorRow(name, value, setValue));
    } else if (type === 'enum') {
      frag.appendChild(makeEnumRow(name, value, c.options, setValue));
    }
  }
  inputsContainer.appendChild(frag);
}

function makeStringRow(name, initial, onChange) {
  const row = document.createElement('div');
  row.className = 'input-row';
  const label = document.createElement('label');
  label.textContent = name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'string-input';
  input.value = String(initial ?? '');
  input.addEventListener('input', () => onChange(input.value));
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function makeColorRow(name, initial, onChange) {
  const row = document.createElement('div');
  row.className = 'input-row';
  const label = document.createElement('label');
  label.textContent = name;
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'color-input';
  input.value = initial || '#000000';
  input.addEventListener('input', () => onChange(input.value));
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function makeEnumRow(name, initial, options, onChange) {
  const row = document.createElement('div');
  row.className = 'input-row';
  const label = document.createElement('label');
  label.textContent = name;
  const select = document.createElement('select');
  select.className = 'enum-input';
  options.forEach((opt, idx) => {
    const option = document.createElement('option');
    option.value = idx;
    option.textContent = opt;
    if (idx === initial) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener('change', () => onChange(parseInt(select.value, 10)));
  row.appendChild(label);
  row.appendChild(select);
  return row;
}

// Dynamically discover all ViewModel properties
function discoverViewModelProperties(vmi) {
  const controllers = [];
  
  console.log('=== Discovering ViewModel Properties ===');
  console.log('ViewModel Instance:', vmi);
  
  // Method 1: Use properties - this returns all bound properties
  console.log('Checking for properties...');
  console.log('typeof vmi.properties:', typeof vmi.properties);
  console.log('vmi.properties value:', vmi.properties);
  
  try {
    // properties might be a getter that returns an object/array, or a method
    let props;
    if (typeof vmi.properties === 'function') {
      props = vmi.properties();
    } else if (vmi.properties !== null && vmi.properties !== undefined) {
      props = vmi.properties;
    }
    console.log('properties returned:', props);
    console.log('properties type:', typeof props);
    
    if (props) {
      // Convert to array if needed
      let propArray;
      if (Array.isArray(props)) {
        propArray = props;
      } else if (props.size !== undefined) {
        // It's a Map or Set
        propArray = Array.from(props.values ? props.values() : props);
      } else if (typeof props[Symbol.iterator] === 'function') {
        propArray = Array.from(props);
      } else {
        propArray = Object.entries(props).map(([key, val]) => ({ name: key, ...val }));
      }
      
      console.log('Converted to array:', propArray);
      console.log('Array length:', propArray.length);
      
      for (let i = 0; i < propArray.length; i++) {
        const prop = propArray[i];
        console.log(`Property ${i}:`, prop);
        console.log(`  Constructor:`, prop?.constructor?.name);
        console.log(`  Keys:`, prop ? Object.keys(prop) : 'null');
        console.log(`  Prototype:`, prop ? Object.getOwnPropertyNames(Object.getPrototypeOf(prop)) : 'null');
        
        if (prop) {
          // Try to get name - might be a method or property
          const name = typeof prop.name === 'function' ? prop.name() : prop.name;
          console.log(`  Name:`, name);
          
          if (name) {
            const controller = createControllerFromRawProperty(prop, vmi);
            if (controller) {
              controllers.push(controller);
              console.log(`  ✓ Created controller for "${name}"`);
            }
          }
        }
      }
    }
  } catch (e) {
    console.log('Error with properties():', e.message, e);
  }
  
  // Method 2: Try propertyFromPath with common paths
  if (controllers.length === 0) {
    console.log('Trying propertyFromPath...');
    
    if (typeof vmi.propertyFromPath === 'function') {
      // Try root path and common paths
      const pathsToTry = ['', '/', 'root', 'default'];
      for (const path of pathsToTry) {
        try {
          const prop = vmi.propertyFromPath(path);
          console.log(`propertyFromPath("${path}"):`, prop);
        } catch (e) {
          console.log(`propertyFromPath("${path}") error:`, e.message);
        }
      }
    }
  }
  
  // Method 3: Direct type accessor methods - try to access properties by guessing names
  if (controllers.length === 0) {
    console.log('Trying direct type accessors...');
    
    // The ViewModel has methods: boolean(name), number(name), string(name), etc.
    // Try accessing properties by trying each type accessor with extracted property names
    const typeAccessors = ['boolean', 'number', 'string', 'trigger', 'enum', 'color'];
    
    // Extract property names from the .riv file buffer dynamically
    const extractedNames = selectedRivBuffer ? extractPropertyNamesFromRiv(selectedRivBuffer) : [];
    console.log('Extracted property names from file:', extractedNames);
    
    // Combine extracted names with some common fallbacks
    const commonPropertyNames = [
      ...extractedNames,
      // Common generic names as fallback
      'toggle', 'value', 'state', 'enabled', 'active', 'visible', 'color',
      'progress', 'count', 'index', 'selected', 'hover', 'pressed', 'checked'
    ];
    
    for (const propName of commonPropertyNames) {
      for (const accessor of typeAccessors) {
        if (typeof vmi[accessor] === 'function') {
          try {
            const prop = vmi[accessor](propName);
            if (prop) {
              console.log(`✓ Found ${accessor} property "${propName}":`, prop);
              console.log(`  Value:`, prop.value);
              const controller = createControllerFromProperty(prop, accessor, vmi);
              if (controller) {
                controllers.push(controller);
                console.log(`  ✓ Created controller for "${propName}" (${accessor})`);
              }
              break; // Found the property type, move to next property name
            }
          } catch (e) {
            // Not this type, continue
          }
        }
      }
    }
    
    // Check if there's a nativeInstance that might have more info
    if (typeof vmi.nativeInstance === 'function') {
      try {
        const native = vmi.nativeInstance();
        console.log('nativeInstance:', native);
        if (native) {
          console.log('nativeInstance keys:', Object.keys(native));
          console.log('nativeInstance prototype:', Object.getOwnPropertyNames(Object.getPrototypeOf(native)));
        }
      } catch (e) {
        console.log('nativeInstance error:', e.message);
      }
    }
    
    // Check runtimeInstance
    if (typeof vmi.runtimeInstance === 'function') {
      try {
        const rt = vmi.runtimeInstance();
        console.log('runtimeInstance:', rt);
        if (rt) {
          console.log('runtimeInstance keys:', Object.keys(rt));
        }
      } catch (e) {
        console.log('runtimeInstance error:', e.message);
      }
    }
  }
  
  // Method 4: Check the internal structure
  if (controllers.length === 0) {
    console.log('Checking internal structure...');
    
    const proto = Object.getPrototypeOf(vmi);
    console.log('Prototype methods:', Object.getOwnPropertyNames(proto));
    
    // Check _children Map
    if (vmi._children instanceof Map) {
      console.log('_children is a Map with', vmi._children.size, 'entries');
      for (const [key, value] of vmi._children) {
        console.log(`  Child "${key}":`, value);
      }
    } else if (vmi._children) {
      console.log('_children:', vmi._children);
      console.log('_children type:', typeof vmi._children);
    }
    
    // Check _viewModelInstances
    if (vmi._viewModelInstances instanceof Map) {
      console.log('_viewModelInstances is a Map with', vmi._viewModelInstances.size, 'entries');
      for (const [key, value] of vmi._viewModelInstances) {
        console.log(`  VM Instance "${key}":`, value);
      }
    }
  }
  
  console.log(`=== Total ViewModel properties discovered: ${controllers.length} ===`);
  return controllers;
}

// Create controller from a raw property object returned by properties()
function createControllerFromRawProperty(prop, vmi) {
  const name = prop.name;
  
  // Try to determine the type from the property object
  // Different Rive versions may expose this differently
  let type = prop.type;
  
  // If type is not directly available, try to infer from constructor name or methods
  if (!type) {
    const ctorName = prop.constructor?.name?.toLowerCase() || '';
    if (ctorName.includes('bool')) type = 'boolean';
    else if (ctorName.includes('number')) type = 'number';
    else if (ctorName.includes('string')) type = 'string';
    else if (ctorName.includes('trigger')) type = 'trigger';
    else if (ctorName.includes('enum')) type = 'enum';
    else if (ctorName.includes('color')) type = 'color';
  }
  
  // If still no type, check what value looks like
  if (!type) {
    const val = prop.value;
    if (typeof val === 'boolean') type = 'boolean';
    else if (typeof val === 'number') type = 'number';
    else if (typeof val === 'string') type = 'string';
    else if (typeof prop.fire === 'function') type = 'trigger';
  }
  
  console.log(`  Inferred type for "${name}": ${type}`);
  
  if (!type) {
    console.log(`  Could not determine type for property "${name}"`);
    return null;
  }
  
  return createControllerFromProperty(prop, type, vmi);
}

function createControllerFromProperty(prop, type, vmi) {
  const name = prop.name;
  
  if (type === 'boolean') {
    return {
      name,
      type: 'boolean',
      value: prop.value,
      setValue: (val) => {
        console.log(`Setting ${name} to ${val}`);
        prop.value = val;
      }
    };
  } else if (type === 'number') {
    return {
      name,
      type: 'number',
      value: prop.value ?? 0,
      setValue: (val) => {
        console.log(`Setting ${name} to ${val}`);
        prop.value = Number.isFinite(val) ? val : 0;
      }
    };
  } else if (type === 'string') {
    return {
      name,
      type: 'string',
      value: prop.value ?? '',
      setValue: (val) => {
        console.log(`Setting ${name} to ${val}`);
        prop.value = val;
      }
    };
  } else if (type === 'trigger') {
    return {
      name,
      type: 'trigger',
      fire: () => {
        console.log(`Firing trigger ${name}`);
        if (typeof prop.fire === 'function') {
          prop.fire();
        } else if (typeof prop.trigger === 'function') {
          prop.trigger();
        } else {
          prop.value = true;
        }
      }
    };
  } else if (type === 'enum') {
    // Get enum options if available
    let options = [];
    if (typeof prop.options === 'function') {
      options = prop.options();
    } else if (Array.isArray(prop.options)) {
      options = prop.options;
    }
    return {
      name,
      type: 'enum',
      value: prop.value ?? 0,
      options: options,
      setValue: (val) => {
        console.log(`Setting ${name} to ${val}`);
        prop.value = val;
      }
    };
  } else if (type === 'color') {
    return {
      name,
      type: 'color',
      value: prop.value ?? '#000000',
      setValue: (val) => {
        console.log(`Setting ${name} to ${val}`);
        prop.value = val;
      }
    };
  }
  
  return null;
}

function tryCreateControllerForProperty(vmi, name) {
  // Try each property type accessor
  const accessors = ['boolean', 'number', 'string', 'trigger', 'enum', 'color'];
  
  for (const accessor of accessors) {
    if (typeof vmi[accessor] === 'function') {
      try {
        const prop = vmi[accessor](name);
        if (prop) {
          return createControllerFromProperty(prop, accessor, vmi);
        }
      } catch (e) {
        // Not this type, continue
      }
    }
  }
  
  return null;
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

  // Don't hardcode artboard/stateMachine names - let Rive use defaults or specified values
  const artboardOpt = currentArtboardName || undefined;
  const smOpt = desiredSM || undefined;
  
  const firstCtorOpts = selectedRivBuffer
    ? { ...commonCtorOpts, buffer: selectedRivBuffer, artboard: artboardOpt, stateMachines: smOpt }
    : { ...commonCtorOpts, src, artboard: artboardOpt, stateMachines: smOpt };

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
      console.log('Rive Instance keys:', Object.keys(riveInstance));
      console.log('State Machine Name:', smName);
      
      // Make sure state machine is playing
      try {
        riveInstance.play(smName);
        console.log('✓ State Machine started:', smName);
      } catch (e) {
        console.log('Error starting state machine:', e.message);
      }
      
      // Check for ViewModel Instance (new Data Binding API)
      const vmi = riveInstance.viewModelInstance;
      if (vmi) {
        console.log('✓ viewModelInstance found!');
        console.log('ViewModel Instance:', vmi);
        console.log('ViewModel Instance keys:', Object.keys(vmi));
        console.log('ViewModel Instance prototype:', Object.getOwnPropertyNames(Object.getPrototypeOf(vmi)));
        
        // Try to dynamically discover ViewModel properties
        const viewModelControllers = discoverViewModelProperties(vmi);
        
        if (viewModelControllers.length > 0) {
          console.log('✓ Found', viewModelControllers.length, 'ViewModel properties');
          buildControls(viewModelControllers);
          return; // Exit early since we're using ViewModel
        } else {
          console.log('No ViewModel properties discovered, falling back to state machine inputs');
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

async function selectLibraryFile(file, btn) {
  // Update UI
  document.querySelectorAll('.library-file').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filePathInput.value = file.path;
  fileChooser.value = '';
  currentLibraryFile = file.path;
  
  // Fetch the file as ArrayBuffer so we can extract property names
  try {
    const response = await fetch(file.path);
    if (response.ok) {
      selectedRivBuffer = await response.arrayBuffer();
      console.log('Library file fetched as buffer, size:', selectedRivBuffer.byteLength);
    } else {
      console.warn('Failed to fetch library file as buffer:', response.status);
      selectedRivBuffer = null;
    }
  } catch (e) {
    console.warn('Error fetching library file:', e);
    selectedRivBuffer = null;
  }
  
  // Load the file
  await loadRive();
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


