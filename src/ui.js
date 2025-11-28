/**
 * UI 模块 - 处理所有用户界面相关的功能
 * 包括: Toast通知、确认对话框、浮层管理、D-pad控制等
 */

/**
 * 显示一个短暂的顶部通知 (Toast)
 * @param {HTMLElement} toastElement - Toast DOM元素
 * @param {string} message - 通知消息
 * @param {number} duration - 显示时长(毫秒)
 * @param {string} type - 类型 ('info', 'success', 'error')
 * @param {object} state - 包含 toastTimeout 的状态对象
 */
export function showToast(toastElement, message, duration = 3000, type = 'info', state) {
    clearTimeout(state.toastTimeout);
    toastElement.classList.remove('show');

    setTimeout(() => {
        toastElement.textContent = message;
        toastElement.className = 'toast'; 
        if (type !== 'info') {
            toastElement.classList.add(type);
        }
        toastElement.classList.add('show');

        state.toastTimeout = setTimeout(() => {
            toastElement.classList.remove('show');
        }, duration);
    }, 100);
}

/**
 * 显示一个确认对话框
 * @param {HTMLElement} overlay - 确认对话框的overlay元素
 * @param {HTMLElement} messageEl - 显示消息的元素
 * @param {HTMLElement} yesBtn - 确认按钮
 * @param {HTMLElement} noBtn - 取消按钮
 * @param {string} message - 确认消息
 * @param {function} onConfirm - 确认回调函数
 */
export function showConfirm(overlay, messageEl, yesBtn, noBtn, message, onConfirm) {
    messageEl.textContent = message;
    overlay.style.display = 'flex';

    const hide = () => {
        overlay.style.display = 'none';
        yesBtn.onclick = null;
        noBtn.onclick = null;
    };

    yesBtn.onclick = () => {
        hide();
        onConfirm();
    };
    noBtn.onclick = hide;
}

/**
 * 隐藏所有游戏状态浮窗
 */
export function hideAllOverlays() {
    document.getElementById('death-overlay').style.display = 'none';
    document.getElementById('game-over-overlay').style.display = 'none';
    document.getElementById('win-overlay').style.display = 'none';
}

/**
 * 初始化D-pad触摸控制
 * @param {object} dpad - D-pad状态对象
 */
export function initializeDpadTouchControls(dpad) {
    const savedLeft = localStorage.getItem('dpadLeft');
    const savedTop = localStorage.getItem('dpadTop');
    const savedScale = localStorage.getItem('dpadScale');
    
    if (savedScale) {
        dpad.currentScale = parseFloat(savedScale);
        dpad.element.style.transform = `scale(${dpad.currentScale})`;
    }
    if (savedLeft && savedTop) {
        dpad.element.style.left = savedLeft;
        dpad.element.style.top = savedTop;
        dpad.element.style.right = 'auto';
        dpad.element.style.bottom = 'auto';
    }

    const ensureJsPositioning = () => {
        if (dpad.element.style.left === '' || dpad.element.style.top === '') {
            const rect = dpad.element.getBoundingClientRect();
            dpad.element.style.left = `${rect.left}px`;
            dpad.element.style.top = `${rect.top}px`;
            dpad.element.style.right = 'auto';
            dpad.element.style.bottom = 'auto';
        }
    };

    dpad.grip.addEventListener('touchstart', (e) => {
        const touches = e.touches;
        if (touches.length === 1) {
            e.preventDefault();
            ensureJsPositioning();
            dpad.isDragging = true;
            dpad.startX = touches[0].clientX;
            dpad.startY = touches[0].clientY;
            dpad.initialLeft = parseFloat(dpad.element.style.left);
            dpad.initialTop = parseFloat(dpad.element.style.top);
        }
    }, { passive: false });

    dpad.element.addEventListener('touchstart', (e) => {
        const touches = e.touches;
        if (touches.length === 2) {
            e.preventDefault();
            ensureJsPositioning();
            dpad.isResizing = true;
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            dpad.initialDist = Math.sqrt(dx * dx + dy * dy);
        }
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!dpad.isDragging && !dpad.isResizing) return;
        e.preventDefault();
        const touches = e.touches;

        if (dpad.isDragging && touches.length === 1) {
            const dx = touches[0].clientX - dpad.startX;
            const dy = touches[0].clientY - dpad.startY;
            dpad.element.style.left = `${dpad.initialLeft + dx}px`;
            dpad.element.style.top = `${dpad.initialTop + dy}px`;
        } else if (dpad.isResizing && touches.length === 2) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            const currentDist = Math.sqrt(dx * dx + dy * dy);
            const scaleChange = currentDist / dpad.initialDist;
            let newScale = dpad.currentScale * scaleChange;
            newScale = Math.max(0.5, Math.min(2.5, newScale));
            dpad.element.style.transform = `scale(${newScale})`;
        }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (dpad.isResizing) {
            const transformStyle = dpad.element.style.transform;
            const scaleMatch = transformStyle.match(/scale\((.+)\)/);
            if (scaleMatch) {
                dpad.currentScale = parseFloat(scaleMatch[1]);
            }
            localStorage.setItem('dpadScale', dpad.currentScale);
        }
        if (dpad.isDragging) {
            localStorage.setItem('dpadLeft', dpad.element.style.left);
            localStorage.setItem('dpadTop', dpad.element.style.top);
        }
        dpad.isDragging = false;
        dpad.isResizing = false;
    });
}

/**
 * 更新D-pad可见性
 * @param {boolean} editorActive - 编辑器是否激活
 */
export function updateDpadVisibility(editorActive) {
    const dpadToggle = document.getElementById('dpad-toggle');
    const dpadControls = document.getElementById('dpad-controls');
    const shouldShow = dpadToggle.checked && !editorActive;
    dpadControls.classList.toggle('hidden', !shouldShow);
}

/**
 * 更新游戏状态UI显示
 * @param {object} config - 配置对象
 */
export function updateUIDisplays(config) {
    const { gameMode, player, loopCount, healthDisplay, keysDisplay, stepsDisplay } = config;
    
    if (gameMode === 'exploration') {
        healthDisplay.textContent = `生命: ${player.hp}`;
        keysDisplay.textContent = `钥匙: ${player.keys}`;
        stepsDisplay.textContent = `步数: ${player.steps}`;
    } else {
        document.getElementById('loop-count-display').textContent = `循环次数: ${loopCount}`;
        document.getElementById('player-keys-display-death-loop').textContent = `钥匙: ${player.keys}`;
        document.getElementById('player-stamina-display').textContent = `剩余体力: ${player.stamina}`;
    }
}

/**
 * 更新周围鬼数量警告
 * @param {object} config - 配置对象
 */
export function updateProximityWarning(config) {
    const { gameMode, ghosts, player, seenCells, debugVision, ghostProximityDisplay } = config;
    
    if (gameMode === 'death-loop') {
        document.body.classList.remove('danger-bg');
        ghostProximityDisplay.classList.remove('warning');
        return;
    }

    let totalNearbyGhosts = 0;
    let invisibleNearbyGhosts = 0;

    for (const ghost of ghosts) {
        if (Math.abs(ghost.x - player.x) <= 1 && Math.abs(ghost.y - player.y) <= 1) {
            totalNearbyGhosts++;
            if (!seenCells[ghost.y][ghost.x] && !debugVision) {
                invisibleNearbyGhosts++;
            }
        }
    }

    ghostProximityDisplay.textContent = `周围鬼数: ${totalNearbyGhosts}`;
    document.body.classList.toggle('danger-bg', invisibleNearbyGhosts > 0);
    ghostProximityDisplay.classList.toggle('warning', invisibleNearbyGhosts > 0);
}

/**
 * 更新历史记录按钮状态
 * @param {object} config - 配置对象
 */
export function updateHistoryButtons(config) {
    const { currentStep, history, checkpoints } = config;
    
    const undoBtn = document.getElementById('undo-btn');
    const saveBtn = document.getElementById('save-btn');
    const rewindBtn = document.getElementById('rewind-btn');

    const canUndo = currentStep > 0 && !history[currentStep].isRevivalPoint;
    undoBtn.disabled = !canUndo;

    const lastCheckpoint = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : -1;
    const canSave = currentStep > lastCheckpoint;
    saveBtn.disabled = !canSave;

    const canRewind = checkpoints.some(cp => cp < currentStep);
    rewindBtn.disabled = !canRewind;
}

/**
 * 更新图层面板
 * @param {object} config - 配置对象
 */
export function updateLayerPanel(config) {
    const { multiLayerMode, layerCount, currentLayer, playerLayer, editorActive, onSwitchLayer } = config;
    
    const panel = document.getElementById('layer-panel');
    if (!multiLayerMode) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'flex';
    const container = document.getElementById('layer-buttons-container');
    container.innerHTML = '';
    
    for (let i = layerCount - 1; i >= 0; i--) {
        const btn = document.createElement('button');
        btn.className = 'layer-btn';
        btn.textContent = (i + 1).toString();
        
        if (i === currentLayer) btn.classList.add('active');
        if (i === playerLayer) btn.classList.add('player-layer');
        
        btn.addEventListener('click', () => onSwitchLayer(i));
        container.appendChild(btn);
    }
    
    document.getElementById('layer-edit-controls').style.display = editorActive ? 'flex' : 'none';
}

/**
 * 更新编辑器模式UI
 * @param {object} config - 配置对象
 */
export function updateEditorUIForMode(config) {
    const { editorMode, multiLayerMode, currentTool, onSetTool, onUpdateLayerPanel } = config;
    
    const isRegular = editorMode === 'regular';
    document.getElementById('edit-type-regular-btn').classList.toggle('active', isRegular);
    document.getElementById('edit-type-free-btn').classList.toggle('active', !isRegular);
    
    document.getElementById('tool-start').style.display = isRegular ? 'none' : 'block';
    document.getElementById('tool-grid').style.display = isRegular ? 'none' : 'block';
    document.getElementById('layer-mode-container').style.display = isRegular ? 'none' : 'block';
    
    if (isRegular && multiLayerMode) {
        onUpdateLayerPanel();
    }
    
    // 更新楼梯工具可见性
    const stairBtn = document.getElementById('tool-stair');
    const shouldShowStair = editorMode === 'free' && multiLayerMode;
    stairBtn.style.display = shouldShowStair ? 'block' : 'none';
    
    if (!shouldShowStair && currentTool === 'stair') {
        onSetTool('wall');
    }
    if (isRegular && (currentTool === 'grid' || currentTool === 'start' || currentTool === 'stair')) {
        onSetTool('wall');
    }
}

/**
 * 更新图层模式UI
 * @param {boolean} multiLayerMode - 是否为多层模式
 */
export function updateLayerModeUI(multiLayerMode) {
    document.getElementById('layer-mode-single-btn').classList.toggle('active', !multiLayerMode);
    document.getElementById('layer-mode-multi-btn').classList.toggle('active', multiLayerMode);
}
