// Configuración Bluetooth BLE del HM-10
const HM10_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const HM10_CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

let bluetoothDevice;
let characteristicCache;
let rxBuffer = '';

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const debugText = document.getElementById('debugText');
const debugPanel = document.getElementById('debugLog');

const currentModeEl = document.getElementById('currentMode');
const windValEl = document.getElementById('windVal');
const windMeterEl = document.getElementById('windMeter');
const compassNeedleEl = document.getElementById('compassNeedle');
const windDirLabelEl = document.getElementById('windDirLabel');
const secN = document.getElementById('sec-n');
const secS = document.getElementById('sec-s');
const secE = document.getElementById('sec-e');
const secO = document.getElementById('sec-o');

// UI Config Elements
const sliderModTh = document.getElementById('sliderModTh');
const sliderCriTh = document.getElementById('sliderCriTh');
const sliderTim = document.getElementById('sliderTim');
const valModTh = document.getElementById('valModTh');
const valCriTh = document.getElementById('valCriTh');
const valTim = document.getElementById('valTim');
const chkNight = document.getElementById('chkNight');

const chkInhN = document.getElementById('chkInhN');
const chkInhS = document.getElementById('chkInhS');
const chkInhE = document.getElementById('chkInhE');
const chkInhO = document.getElementById('chkInhO');

// Eventos Bluetooth
connectBtn.addEventListener('click', () => {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        disconnect();
    } else {
        connect();
    }
});

// Enviar Comandos Bluetooth
async function sendBluetoothCommand(cmd) {
    if (characteristicCache) {
        try {
            const encoder = new TextEncoder();
            await characteristicCache.writeValueWithoutResponse(encoder.encode(cmd + '\n'));
        } catch (error) {
            log('Error Tx: ' + error);
        }
    }
}

// Eventos de Configuración UI
sliderModTh.addEventListener('change', (e) => sendBluetoothCommand(`SET:MOD:${e.target.value}`));
sliderModTh.addEventListener('input', (e) => valModTh.textContent = e.target.value);

sliderCriTh.addEventListener('change', (e) => sendBluetoothCommand(`SET:CRI:${e.target.value}`));
sliderCriTh.addEventListener('input', (e) => valCriTh.textContent = e.target.value);

sliderTim.addEventListener('change', (e) => sendBluetoothCommand(`SET:TIM:${e.target.value}`));
sliderTim.addEventListener('input', (e) => valTim.textContent = e.target.value);

chkNight.addEventListener('change', (e) => sendBluetoothCommand(`SET:NIG:${e.target.checked ? 1 : 0}`));

function updateInhibits() {
    let mask = 0;
    if (chkInhN.checked) mask |= (1 << 0);
    if (chkInhS.checked) mask |= (1 << 1);
    if (chkInhE.checked) mask |= (1 << 2);
    if (chkInhO.checked) mask |= (1 << 3);
    sendBluetoothCommand(`SET:INH:${mask}`);
}
chkInhN.addEventListener('change', updateInhibits);
chkInhS.addEventListener('change', updateInhibits);
chkInhE.addEventListener('change', updateInhibits);
chkInhO.addEventListener('change', updateInhibits);

// Funciones Bluetooth
async function connect() {
    try {
        log('Solicitando dispositivo Bluetooth...');
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [HM10_SERVICE_UUID] }],
            optionalServices: [HM10_SERVICE_UUID]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        log('Conectando al servidor GATT...');
        const server = await bluetoothDevice.gatt.connect();

        log('Obteniendo servicio...');
        const service = await server.getPrimaryService(HM10_SERVICE_UUID);

        log('Obteniendo característica...');
        characteristicCache = await service.getCharacteristic(HM10_CHARACTERISTIC_UUID);

        log('Iniciando notificaciones...');
        await characteristicCache.startNotifications();
        characteristicCache.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);

        updateUIConnection(true);
        log('¡Conectado exitosamente!');
    } catch (error) {
        log('Error: ' + error);
        console.error(error);
    }
}

function disconnect() {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    }
}

function onDisconnected() {
    updateUIConnection(false);
    resetUI();
    log('Dispositivo desconectado');
}

// Procesamiento de datos (UART HM-10 envía bytes en fragmentos)
function handleCharacteristicValueChanged(event) {
    const value = new TextDecoder().decode(event.target.value);
    rxBuffer += value;

    // Buscamos saltos de línea (asumiendo que la STM32 envía JSON + \n)
    let lines = rxBuffer.split('\n');
    
    // Si hay al menos una línea completa
    if (lines.length > 1) {
        // Procesamos todas las líneas completas excepto el último fragmento incompleto
        for (let i = 0; i < lines.length - 1; i++) {
            let jsonString = lines[i].trim();
            if (jsonString.startsWith('{') && jsonString.endsWith('}')) {
                parseSTM32Data(jsonString);
            }
        }
        // Dejamos el último fragmento (que puede estar incompleto) en el buffer
        rxBuffer = lines[lines.length - 1];
    }
}

// Parseo del JSON enviado por STM32
function parseSTM32Data(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        
        // Actualizar UI de telemetría
        updateMode(data.m);
        updateWind(data.v, data.d);
        updateSectors(data.s);

        // Actualizar UI de configuración solo si no los estamos tocando (para evitar glitches)
        if (data.c_mod !== undefined) {
            if (document.activeElement !== sliderModTh) { sliderModTh.value = data.c_mod; valModTh.textContent = data.c_mod; }
            if (document.activeElement !== sliderCriTh) { sliderCriTh.value = data.c_cri; valCriTh.textContent = data.c_cri; }
            if (document.activeElement !== sliderTim) { sliderTim.value = data.c_tim; valTim.textContent = data.c_tim; }
            
            chkNight.checked = (data.c_nig === 1);
            
            let mask = data.c_inh || 0;
            chkInhN.checked = (mask & (1 << 0)) !== 0;
            chkInhS.checked = (mask & (1 << 1)) !== 0;
            chkInhE.checked = (mask & (1 << 2)) !== 0;
            chkInhO.checked = (mask & (1 << 3)) !== 0;
        }
        
        // Mostrar latido en vez de JSON crudo
        log('Telemetría recibida ✓');
    } catch (e) {
        log('Error parseando JSON: ' + e.message);
    }
}

// UI Updates
function updateUIConnection(isConnected) {
    if (isConnected) {
        connectBtn.innerHTML = '<span class="icon">🔌</span> Desconectar';
        connectBtn.classList.add('connected');
        debugPanel.classList.remove('hidden');
    } else {
        connectBtn.innerHTML = '<span class="icon">🔌</span> Conectar HM-10';
        connectBtn.classList.remove('connected');
    }
}

function updateMode(mode) {
    currentModeEl.className = 'badge';
    
    if (mode === 'NORMAL') {
        currentModeEl.textContent = 'NORMAL';
        currentModeEl.classList.add('badge-normal');
    } else if (mode === 'SETUP') {
        currentModeEl.textContent = 'SET-UP';
        currentModeEl.classList.add('badge-setup');
    } else if (mode === 'FALLA') {
        currentModeEl.textContent = 'FALLA CRÍTICA';
        currentModeEl.classList.add('badge-falla');
    } else {
        currentModeEl.textContent = mode;
        currentModeEl.classList.add('badge-offline');
    }
}

function updateWind(speed, direction) {
    // Speed: 0 to 100%
    const clampedSpeed = Math.min(Math.max(speed, 0), 100);
    windValEl.textContent = clampedSpeed;
    
    // Circle circumference is 283. Offset calculation: 283 - (speed / 100) * 283
    const offset = 283 - (clampedSpeed / 100) * 283;
    windMeterEl.style.strokeDashoffset = offset;

    // Color code speed
    if (clampedSpeed < 30) windMeterEl.style.stroke = 'var(--neon-green)';
    else if (clampedSpeed < 70) windMeterEl.style.stroke = 'var(--neon-orange)';
    else windMeterEl.style.stroke = 'var(--neon-red)';

    // Direction (N, S, E, O)
    windDirLabelEl.textContent = direction;
    let rotation = 0;
    switch(direction) {
        case 'N': rotation = 0; break;
        case 'E': rotation = 90; break;
        case 'S': rotation = 180; break;
        case 'O': rotation = 270; break;
    }
    compassNeedleEl.style.transform = `rotate(${rotation}deg)`;
}

function updateSectors(sectors) {
    // Esperamos un array [N, S, E, O] con 1s o 0s
    if (!Array.isArray(sectors) || sectors.length !== 4) return;
    
    secN.classList.toggle('active', sectors[0] === 1);
    secS.classList.toggle('active', sectors[1] === 1);
    secE.classList.toggle('active', sectors[2] === 1);
    secO.classList.toggle('active', sectors[3] === 1);
}

function resetUI() {
    updateMode('OFFLINE');
    updateWind(0, '-');
    updateSectors([0,0,0,0]);
}

function log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    debugText.textContent = `[${timestamp}] ${msg}`;
}

// Init
resetUI();
