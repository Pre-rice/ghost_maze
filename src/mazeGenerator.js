import { WALL_TYPES } from './constants.js';

/**
 * MazeGenerator 模块 - 处理迷宫生成算法
 */

/**
 * 创建空墙数据结构
 * @param {string} type - 'h' 或 'v'
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {Array} 墙数组
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
 * 生成随机迷宫
 * @param {number} width - 迷宫宽度
 * @param {number} height - 迷宫高度
 * @returns {object} 包含 hWalls 和 vWalls 的对象
 */
export function generateMaze(width, height) {
    const solid = () => ({ type: WALL_TYPES.SOLID, keys: 0 });
    const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
    
    // 初始化所有墙壁为实心
    const hWalls = Array.from({ length: height + 1 }, () => Array.from({ length: width }, solid));
    const vWalls = Array.from({ length: height }, () => Array.from({ length: width + 1 }, solid));
    
    // 左下角3x3起始房间
    const roomY = height - 3;
    for (let y = roomY; y < roomY + 3; y++) {
        for (let x = 0; x < 3; x++) {
            if (x < 2) vWalls[y][x + 1] = empty();
            if (y < roomY + 2) hWalls[y + 1][x] = empty();
        }
    }
    vWalls[roomY][0] = solid();
    vWalls[roomY + 1][0] = solid();
    vWalls[roomY + 2][0] = solid();
    
    // 使用深度优先搜索生成迷宫
    const visited = Array.from({ length: height }, () => Array(width).fill(false));
    for (let y = roomY; y < roomY + 3; y++) {
        for (let x = 0; x < 3; x++) {
            visited[y][x] = true;
        }
    }
    
    const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    const stack = [{ x: 2, y: roomY }]; // 从起始房间的右上角开始
    
    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        const neighbors = [];
        
        for (const dir of dirs) {
            const nx = current.x + dir.x;
            const ny = current.y + dir.y;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
                neighbors.push({ x: nx, y: ny, dir: dir });
            }
        }
        
        if (neighbors.length > 0) {
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            visited[next.y][next.x] = true;
            const dir = next.dir;
            
            if (dir.x === 1) vWalls[current.y][current.x + 1] = empty();
            else if (dir.x === -1) vWalls[current.y][current.x] = empty();
            else if (dir.y === 1) hWalls[current.y + 1][current.x] = empty();
            else if (dir.y === -1) hWalls[current.y][current.x] = empty();
            
            stack.push({ x: next.x, y: next.y });
        } else {
            stack.pop();
        }
    }
    
    // 随机移除一些墙壁增加路径多样性
    const wallsToRemove = Math.floor((width + height) / 3);
    let removedCount = 0;
    let attempts = 0;
    
    while (removedCount < wallsToRemove && attempts < wallsToRemove * 10) {
        attempts++;
        const rx = Math.floor(Math.random() * width);
        const ry = Math.floor(Math.random() * height);
        
        if (Math.random() > 0.5) {
            if (rx < width - 1 && !(ry >= roomY && ry < roomY + 3 && rx + 1 === 3)) {
                if (vWalls[ry][rx + 1].type === WALL_TYPES.SOLID) {
                    vWalls[ry][rx + 1] = empty();
                    removedCount++;
                }
            }
        } else {
            if (ry < height - 1 && !(rx >= 0 && rx < 3 && ry + 1 === roomY)) {
                if (hWalls[ry + 1][rx].type === WALL_TYPES.SOLID) {
                    hWalls[ry + 1][rx] = empty();
                    removedCount++;
                }
            }
        }
    }
    
    return { hWalls, vWalls };
}

/**
 * 计算从起点到所有可达单元格的距离
 * @param {object} startNode - 起点 {x, y}
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {Array} hWalls - 横墙数组
 * @param {Array} vWalls - 竖墙数组
 * @returns {Array} 距离数组
 */
export function calculateDistances(startNode, width, height, hWalls, vWalls) {
    const distances = Array.from({ length: height }, () => Array(width).fill(-1));
    const queue = [{ ...startNode, dist: 0 }];
    distances[startNode.y][startNode.x] = 0;
    
    const canMove = (x, y, dx, dy) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return false;
        
        if (dx === 1 && vWalls[y][x + 1].type !== WALL_TYPES.EMPTY) return false;
        if (dx === -1 && vWalls[y][x].type !== WALL_TYPES.EMPTY) return false;
        if (dy === 1 && hWalls[y + 1][x].type !== WALL_TYPES.EMPTY) return false;
        if (dy === -1 && hWalls[y][x].type !== WALL_TYPES.EMPTY) return false;
        
        return true;
    };
    
    while (queue.length > 0) {
        const current = queue.shift();
        const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
        
        for (const dir of dirs) {
            if (canMove(current.x, current.y, dir.x, dir.y)) {
                const nx = current.x + dir.x;
                const ny = current.y + dir.y;
                if (distances[ny][nx] === -1) {
                    distances[ny][nx] = current.dist + 1;
                    queue.push({ x: nx, y: ny, dist: current.dist + 1 });
                }
            }
        }
    }
    
    return distances;
}

/**
 * 找到距离起点最远的可达单元格
 * @param {object} startPos - 起点位置
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {Array} hWalls - 横墙数组
 * @param {Array} vWalls - 竖墙数组
 * @returns {object} 最远单元格位置 {x, y}
 */
export function findFarthestEndCell(startPos, width, height, hWalls, vWalls) {
    const distances = calculateDistances(startPos, width, height, hWalls, vWalls);
    
    let farthest = { x: 0, y: 0, dist: -1 };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (distances[y][x] > farthest.dist) {
                farthest = { x, y, dist: distances[y][x] };
            }
        }
    }
    
    return { x: farthest.x, y: farthest.y };
}

/**
 * 生成随机放置的物品和实体
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {object} startPos - 起点位置
 * @param {object} endPos - 终点位置
 * @param {number} ghostCount - 鬼的数量
 * @param {number} keyCount - 钥匙数量
 * @returns {object} 包含 ghosts 和 items 的对象
 */
export function generateEntities(width, height, startPos, endPos, ghostCount = 3, keyCount = 3) {
    const ghosts = [];
    const items = [];
    
    // 获取所有有效位置（排除起点和终点附近）
    const validPositions = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // 排除起始房间
            if (y >= height - 3 && x < 3) continue;
            // 排除终点
            if (x === endPos.x && y === endPos.y) continue;
            validPositions.push({ x, y });
        }
    }
    
    // 随机打乱位置
    for (let i = validPositions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [validPositions[i], validPositions[j]] = [validPositions[j], validPositions[i]];
    }
    
    // 放置鬼
    for (let i = 0; i < Math.min(ghostCount, validPositions.length); i++) {
        ghosts.push({ x: validPositions[i].x, y: validPositions[i].y, trail: [] });
    }
    
    // 放置钥匙（从剩余位置中选择）
    const keyStartIndex = ghostCount;
    for (let i = 0; i < Math.min(keyCount, validPositions.length - keyStartIndex); i++) {
        items.push({ x: validPositions[keyStartIndex + i].x, y: validPositions[keyStartIndex + i].y, type: 'key' });
    }
    
    return { ghosts, items };
}

/**
 * 创建完整的随机地图数据
 * @param {number} size - 地图大小
 * @returns {object} 完整的地图数据对象
 */
export function createRandomMapData(size) {
    const width = size;
    const height = size;
    
    // 生成迷宫
    const { hWalls, vWalls } = generateMaze(width, height);
    
    // 设置起点和终点
    const startPos = { x: 1, y: height - 2 };
    const endPos = findFarthestEndCell(startPos, width, height, hWalls, vWalls);
    
    // 生成实体
    const ghostCount = Math.floor(size / 3);
    const keyCount = 3;
    const { ghosts, items } = generateEntities(width, height, startPos, endPos, ghostCount, keyCount);
    
    // 设置终点门需要的钥匙数
    if (endPos.x === 0) {
        vWalls[endPos.y][0] = { type: WALL_TYPES.LOCKED, keys: keyCount };
    } else if (endPos.x === width - 1) {
        vWalls[endPos.y][width] = { type: WALL_TYPES.LOCKED, keys: keyCount };
    } else if (endPos.y === 0) {
        hWalls[0][endPos.x] = { type: WALL_TYPES.LOCKED, keys: keyCount };
    } else if (endPos.y === height - 1) {
        hWalls[height][endPos.x] = { type: WALL_TYPES.LOCKED, keys: keyCount };
    }
    
    // 创建活动单元格数组（全部为true）
    const activeCells = Array(height).fill(null).map(() => Array(width).fill(true));
    
    return {
        width,
        height,
        hWalls,
        vWalls,
        startPos,
        endPos,
        initialGhosts: ghosts,
        items,
        buttons: [],
        activeCells,
        editorMode: 'regular',
        customStartPos: null,
        multiLayerMode: false,
        layerCount: 1,
        layers: [],
        stairs: []
    };
}
