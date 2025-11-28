import { WALL_TYPES } from './constants.js';

/**
 * LayerManager 模块 - 管理多层地图
 */

/**
 * 创建新的空白层
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @returns {object} 新层数据
 */
export function createNewLayer(width, height) {
    const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
    return {
        hWalls: Array(height + 1).fill(null).map(() => Array(width).fill(null).map(empty)),
        vWalls: Array(height).fill(null).map(() => Array(width + 1).fill(null).map(empty)),
        activeCells: Array(height).fill(null).map(() => Array(width).fill(true)),
        ghosts: [],
        items: [],
        buttons: [],
        stairs: [],
        endPos: null,
        customStartPos: null
    };
}

/**
 * 保存当前层数据
 * @param {object} currentData - 当前层的数据
 * @param {number} layerIndex - 层索引
 * @param {Array} layers - 所有层的数组
 */
export function saveLayerData(currentData, layerIndex, layers) {
    if (layers.length === 0) return;
    layers[layerIndex] = {
        hWalls: currentData.hWalls,
        vWalls: currentData.vWalls,
        activeCells: currentData.activeCells,
        ghosts: currentData.ghosts,
        items: currentData.items,
        buttons: currentData.buttons,
        stairs: currentData.stairs.filter(s => s.layer === layerIndex),
        endPos: currentData.endPos,
        customStartPos: currentData.customStartPos
    };
}

/**
 * 加载层数据
 * @param {number} layerIndex - 层索引
 * @param {Array} layers - 所有层的数组
 * @returns {object|null} 层数据
 */
export function loadLayerData(layerIndex, layers) {
    if (!layers[layerIndex]) return null;
    const layer = layers[layerIndex];
    return {
        hWalls: layer.hWalls,
        vWalls: layer.vWalls,
        activeCells: layer.activeCells,
        ghosts: layer.ghosts,
        items: layer.items,
        buttons: layer.buttons,
        endPos: layer.endPos,
        customStartPos: layer.customStartPos
    };
}

/**
 * 删除层时清理楼梯引用
 * @param {Array} layers - 所有层的数组
 * @param {number} removedLayerIndex - 被删除的层索引
 */
export function cleanupStairsOnLayerRemove(layers, removedLayerIndex) {
    for (let i = 0; i < layers.length; i++) {
        layers[i].stairs = layers[i].stairs.filter(s => 
            !(s.direction === 'up' && i === removedLayerIndex - 1)
        );
    }
}

/**
 * 更新层面板UI
 * @param {object} config - 配置
 */
export function updateLayerPanelUI(config) {
    const { 
        multiLayerMode, 
        layerCount, 
        currentLayer, 
        playerLayer, 
        editorActive,
        hasStartPoint,  // 新增：是否有起点
        onLayerClick 
    } = config;
    
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
        // 仅在有起点时才显示黄色边框标记玩家所在层
        if (i === playerLayer && hasStartPoint !== false) btn.classList.add('player-layer');
        btn.addEventListener('click', () => onLayerClick(i));
        container.appendChild(btn);
    }
    
    document.getElementById('layer-edit-controls').style.display = editorActive ? 'flex' : 'none';
}
