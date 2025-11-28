import { WALL_TYPES, GAME_STATES, EDITOR_TOOLS } from './constants.js';

/**
 * Editor 模块 - 处理地图编辑器相关功能
 */

/**
 * 创建空白编辑器地图
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {string} editorMode - 编辑模式 ('regular' | 'free')
 * @returns {object} 地图数据
 */
export function createBlankEditorMap(width, height, editorMode) {
    const wall = () => ({ type: WALL_TYPES.SOLID, keys: 0 });
    const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
    
    const hWalls = Array(height + 1).fill(null).map((_, y) => 
        Array(width).fill(null).map(() => (y === 0 || y === height) ? wall() : empty())
    );
    const vWalls = Array(height).fill(null).map(() => 
        Array(width + 1).fill(null).map((_, x) => (x === 0 || x === width) ? wall() : empty())
    );
    
    let activeCells;
    if (editorMode === 'regular') {
        activeCells = Array(height).fill(null).map(() => Array(width).fill(true));
    } else {
        activeCells = Array(height).fill(null).map(() => Array(width).fill(false));
    }
    
    return {
        width,
        height,
        hWalls,
        vWalls,
        activeCells,
        endPos: null,
        customStartPos: null,
        ghosts: [],
        items: [],
        buttons: [],
        stairs: []
    };
}

/**
 * 创建空墙数据
 * @param {string} type - 'h' 或 'v'
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {Array}
 */
export function createEmptyWalls(type, width, height) {
    const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
    if (type === 'h') {
        return Array.from({ length: height + 1 }, (_, y) =>
            Array.from({ length: width }, () => (y === 0 || y === height) ? { type: WALL_TYPES.SOLID } : empty())
        );
    } else {
        return Array.from({ length: height }, () =>
            Array.from({ length: width + 1 }, (_, x) => (x === 0 || x === width) ? { type: WALL_TYPES.SOLID } : empty())
        );
    }
}

/**
 * 检查位置是否在起始房间内
 * @param {number} cellX - 单元格X
 * @param {number} cellY - 单元格Y  
 * @param {number} height - 地图高度
 * @returns {boolean}
 */
export function isPosInStartRoom(cellX, cellY, height) {
    const roomY = height - 3;
    return cellX >= 0 && cellX < 3 && cellY >= roomY && cellY < roomY + 3;
}

/**
 * 检查墙是否可编辑
 * @param {object} wall - 墙对象 {x, y, type: 'h'|'v'}
 * @param {string} editorMode - 编辑模式
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @returns {boolean}
 */
export function isWallEditable(wall, editorMode, width, height, activeCells = null) {
    if (!wall) return false;
    const { x, y, type } = wall;
    const roomY = height - 3;
    
    if (editorMode === 'free') {
        // 在自由模式下，需要检查相邻单元格是否激活
        if (activeCells) {
            const up = (type === 'h' && y > 0) ? activeCells[y - 1][x] : false;
            const down = (type === 'h' && y < height) ? activeCells[y][x] : false;
            const left = (type === 'v' && x > 0) ? activeCells[y][x - 1] : false;
            const right = (type === 'v' && x < width) ? activeCells[y][x] : false;
            if (type === 'h') return up && down;
            if (type === 'v') return left && right;
            return false;
        }
        return true;
    }
    
    // 常规模式下的边界检查
    if (type === 'h') {
        if (y === 0 || y === height) return false;
        if (x >= 0 && x < 3 && y === roomY) return false;
        if (x >= 0 && x < 3 && y >= roomY && y < roomY + 3) return false;
    } else {
        if (x === 0 || x === width) return false;
        if (y >= roomY && y < roomY + 3 && x === 3) return false;
        if (x >= 0 && x < 3 && y >= roomY && y < roomY + 3) return false;
    }
    return true;
}

/**
 * 检查单元格是否被占用
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {object} entities - 实体对象 {ghosts, items, buttons, endPos, customStartPos, stairs, currentLayer}
 * @returns {boolean}
 */
export function isCellOccupied(x, y, entities) {
    const { ghosts, items, buttons, endPos, customStartPos, stairs, currentLayer } = entities;
    
    if (ghosts && ghosts.some(g => g.x === x && g.y === y)) return true;
    if (items && items.some(i => i.x === x && i.y === y)) return true;
    if (buttons && buttons.some(b => b.x === x && b.y === y)) return true;
    if (endPos && endPos.x === x && endPos.y === y) return true;
    if (customStartPos && customStartPos.x === x && customStartPos.y === y) return true;
    if (stairs && stairs.some(s => s.x === x && s.y === y && s.layer === currentLayer)) return true;
    
    return false;
}

/**
 * 擦除位置上的实体
 * @param {object} pos - 位置 {x, y}
 * @param {object} entities - 实体对象
 * @returns {object} 更新后的实体
 */
export function eraseEntityAtPos(pos, entities) {
    const { x, y } = pos;
    let { ghosts, items, buttons, endPos, customStartPos, stairs, currentLayer } = entities;
    
    ghosts = ghosts.filter(g => !(g.x === x && g.y === y));
    items = items.filter(i => !(i.x === x && i.y === y));
    buttons = buttons.filter(b => !(b.x === x && b.y === y));
    stairs = stairs.filter(s => !(s.x === x && s.y === y && s.layer === currentLayer));
    
    if (endPos && endPos.x === x && endPos.y === y) {
        endPos = null;
    }
    if (customStartPos && customStartPos.x === x && customStartPos.y === y) {
        customStartPos = null;
    }
    
    return { ghosts, items, buttons, endPos, customStartPos, stairs };
}

/**
 * 检查楼梯放置是否有效
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {string} direction - 方向 ('up' | 'down')
 * @param {object} config - 配置 {activeCells, stairs, currentLayer, layerCount}
 * @returns {boolean}
 */
export function isValidStairPlacement(x, y, direction, config) {
    const { activeCells, stairs, currentLayer, layerCount } = config;
    
    if (!activeCells[y] || !activeCells[y][x]) return false;
    if (stairs.some(s => s.x === x && s.y === y && s.layer === currentLayer)) return false;
    if (direction === 'up' && currentLayer >= layerCount - 1) return false;
    if (direction === 'down' && currentLayer <= 0) return false;
    
    return true;
}

/**
 * 切换活动单元格状态
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {string} action - 'add' | 'remove'
 * @param {Array} activeCells - 活动单元格数组
 * @param {object} entities - 实体对象
 * @returns {object} 更新后的 {activeCells, entities}
 */
export function toggleActiveCell(x, y, action, activeCells, entities) {
    const newActiveCells = activeCells.map(row => [...row]);
    let newEntities = { ...entities };
    
    if (action === 'add') {
        newActiveCells[y][x] = true;
    } else if (action === 'remove') {
        newActiveCells[y][x] = false;
        // 移除该单元格上的所有实体
        newEntities = eraseEntityAtPos({ x, y }, entities);
    }
    
    return { activeCells: newActiveCells, entities: newEntities };
}

/**
 * 切换墙类型
 * @param {object} wall - 墙对象
 * @param {number} targetType - 目标类型
 * @param {Array} hWalls - 横墙数组
 * @param {Array} vWalls - 竖墙数组
 * @returns {object} 更新后的 {hWalls, vWalls}
 */
export function toggleWall(wall, targetType, hWalls, vWalls) {
    const { x, y, type } = wall;
    const newHWalls = hWalls.map(row => row.map(w => ({ ...w })));
    const newVWalls = vWalls.map(row => row.map(w => ({ ...w })));
    
    const wallArray = type === 'h' ? newHWalls : newVWalls;
    const currentWall = wallArray[y][x];
    
    if (currentWall.type === targetType) {
        wallArray[y][x] = { type: WALL_TYPES.EMPTY, keys: 0 };
    } else {
        wallArray[y][x] = { type: targetType, keys: currentWall.keys || 0 };
    }
    
    return { hWalls: newHWalls, vWalls: newVWalls };
}

/**
 * 验证地图数据是否可以游玩
 * @param {object} mapData - 地图数据
 * @param {string} editorMode - 编辑模式
 * @returns {object} {valid: boolean, error?: string}
 */
export function validateMapForPlay(mapData, editorMode) {
    if (editorMode === 'free') {
        // 自由模式必须有起点
        if (!mapData.customStartPos) {
            return { valid: false, error: '自由模式必须设置起点！' };
        }
        // 检查是否有至少一个活动单元格
        let hasActive = false;
        for (let y = 0; y < mapData.height; y++) {
            for (let x = 0; x < mapData.width; x++) {
                if (mapData.activeCells[y][x]) {
                    hasActive = true;
                    break;
                }
            }
            if (hasActive) break;
        }
        if (!hasActive) {
            return { valid: false, error: '地图必须有至少一个活动单元格！' };
        }
    }
    return { valid: true };
}

/**
 * 获取墙位置
 * @param {number} mouseX - 鼠标X
 * @param {number} mouseY - 鼠标Y
 * @param {number} cellSize - 单元格大小
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {string} currentTool - 当前工具
 * @returns {object|null} 墙对象
 */
export function getWallAtPos(mouseX, mouseY, cellSize, width, height, currentTool) {
    const threshold = cellSize * 0.3;
    const cellX = Math.floor(mouseX / cellSize);
    const cellY = Math.floor(mouseY / cellSize);
    const cellOffsetX = mouseX - cellX * cellSize;
    const cellOffsetY = mouseY - cellY * cellSize;
    
    if (currentTool === EDITOR_TOOLS.GRID) {
        if (cellX >= 0 && cellX < width && cellY >= 0 && cellY < height) {
            return { x: cellX, y: cellY, type: 'cell' };
        }
        return null;
    }
    
    let bestWall = null;
    let bestDist = threshold;
    
    // 检查上边界
    if (cellY >= 0 && cellY <= height && cellX >= 0 && cellX < width && cellOffsetY < threshold) {
        if (cellOffsetY < bestDist) {
            bestDist = cellOffsetY;
            bestWall = { x: cellX, y: cellY, type: 'h' };
        }
    }
    
    // 检查左边界
    if (cellX >= 0 && cellX <= width && cellY >= 0 && cellY < height && cellOffsetX < threshold) {
        if (cellOffsetX < bestDist) {
            bestDist = cellOffsetX;
            bestWall = { x: cellX, y: cellY, type: 'v' };
        }
    }
    
    // 检查下边界
    if (cellY + 1 >= 0 && cellY + 1 <= height && cellX >= 0 && cellX < width && cellSize - cellOffsetY < threshold) {
        if (cellSize - cellOffsetY < bestDist) {
            bestDist = cellSize - cellOffsetY;
            bestWall = { x: cellX, y: cellY + 1, type: 'h' };
        }
    }
    
    // 检查右边界
    if (cellX + 1 >= 0 && cellX + 1 <= width && cellY >= 0 && cellY < height && cellSize - cellOffsetX < threshold) {
        if (cellSize - cellOffsetX < bestDist) {
            bestWall = { x: cellX + 1, y: cellY, type: 'v' };
        }
    }
    
    return bestWall;
}

/**
 * 获取按钮热点
 * @param {number} mouseX - 鼠标X
 * @param {number} mouseY - 鼠标Y
 * @param {number} cellSize - 单元格大小
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {Array} activeCells - 活动单元格
 * @returns {object|null}
 */
export function getButtonHotspotAtPos(mouseX, mouseY, cellSize, width, height, activeCells) {
    const hotspotSize = cellSize * 0.4;
    const cellX = Math.floor(mouseX / cellSize);
    const cellY = Math.floor(mouseY / cellSize);
    
    if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) return null;
    if (!activeCells[cellY][cellX]) return null;
    
    const cellCenterX = cellX * cellSize + cellSize / 2;
    const cellCenterY = cellY * cellSize + cellSize / 2;
    
    const checkHotspot = (dx, dy, direction) => {
        const hotspotCenterX = cellCenterX + dx * (cellSize / 2 - hotspotSize / 2);
        const hotspotCenterY = cellCenterY + dy * (cellSize / 2 - hotspotSize / 2);
        const distX = Math.abs(mouseX - hotspotCenterX);
        const distY = Math.abs(mouseY - hotspotCenterY);
        if (distX < hotspotSize / 2 && distY < hotspotSize / 2) {
            return { x: cellX, y: cellY, direction };
        }
        return null;
    };
    
    const hotspots = [
        checkHotspot(0, -1, { dx: 0, dy: -1 }),
        checkHotspot(0, 1, { dx: 0, dy: 1 }),
        checkHotspot(-1, 0, { dx: -1, dy: 0 }),
        checkHotspot(1, 0, { dx: 1, dy: 0 })
    ];
    
    return hotspots.find(h => h !== null) || null;
}
