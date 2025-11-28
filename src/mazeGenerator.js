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
 * 检查位置是否在起始房间
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {number} height - 地图高度
 * @returns {boolean}
 */
export function isPosInStartRoom(x, y, height) {
    const roomY = height - 3;
    return x >= 0 && x < 3 && y >= roomY && y < roomY + 3;
}

/**
 * 计算从起点到所有单元格的距离
 * @param {object} startNode - 起点 {x, y}
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {Array} hWalls - 横墙
 * @param {Array} vWalls - 竖墙
 * @returns {Array} 距离数组
 */
export function calculateDistances(startNode, width, height, hWalls, vWalls) {
    const distances = Array.from({ length: height }, () => Array(width).fill(-1));
    const queue = [{ ...startNode, dist: 0 }];
    distances[startNode.y][startNode.x] = 0;
    
    const canMove = (x, y, dx, dy) => {
        const nx = x + dx, ny = y + dy;
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
                const nx = current.x + dir.x, ny = current.y + dir.y;
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
 * 找到距离起点最远的边缘单元格
 * @param {object} startPos - 起点
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {Array} hWalls - 横墙
 * @param {Array} vWalls - 竖墙
 * @returns {object} 最远的边缘单元格
 */
export function findFarthestEndCell(startPos, width, height, hWalls, vWalls) {
    const distances = calculateDistances(startPos, width, height, hWalls, vWalls);
    let maxDist = -1, farthestCell = null;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // 只考虑边缘单元格
            if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                // 检查是否有足够多的墙（死角更好）
                let wallCount = 0;
                if (hWalls[y][x].type > 0) wallCount++;
                if (hWalls[y + 1][x].type > 0) wallCount++;
                if (vWalls[y][x].type > 0) wallCount++;
                if (vWalls[y][x + 1].type > 0) wallCount++;
                
                if (wallCount >= 3 && distances[y][x] > maxDist) {
                    maxDist = distances[y][x];
                    farthestCell = { x, y };
                }
            }
        }
    }
    return farthestCell || { x: width - 1, y: 0 };
}

/**
 * 生成完整的随机迷宫（包含门、鬼、钥匙等）
 * @param {number} width - 迷宫宽度
 * @param {number} height - 迷宫高度
 * @param {number} ghostCount - 鬼数量
 * @returns {object} 完整的地图数据
 */
export function generateFullMaze(width, height, ghostCount = 3) {
    const solid = () => ({ type: WALL_TYPES.SOLID, keys: 0 });
    const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
    const door = () => ({ type: WALL_TYPES.DOOR, keys: 0 });
    
    // 初始化所有墙壁为实心
    const hWalls = Array(height + 1).fill(null).map(() => Array(width).fill(null).map(solid));
    const vWalls = Array(height).fill(null).map(() => Array(width + 1).fill(null).map(solid));
    
    // 左下角3x3起始房间
    const roomY = height - 3;
    for (let y = roomY; y < roomY + 3; y++) {
        for (let x = 0; x < 3; x++) {
            if (x < 2) vWalls[y][x + 1] = empty();
            if (y < roomY + 2) hWalls[y + 1][x] = empty();
        }
    }
    // 起始房间出口门
    vWalls[roomY + 1][3] = door();
    hWalls[roomY][1] = door();
    
    const startPos = { x: 1, y: height - 2 };
    
    // DFS生成迷宫
    const visited = Array(height).fill(null).map(() => Array(width).fill(false));
    for (let y = roomY; y < roomY + 3; y++) {
        for (let x = 0; x < 3; x++) {
            visited[y][x] = true;
        }
    }
    
    const stack = [];
    let startGenX, startGenY;
    do {
        startGenX = Math.floor(Math.random() * width);
        startGenY = Math.floor(Math.random() * height);
    } while (visited[startGenY][startGenX]);
    
    stack.push({ x: startGenX, y: startGenY });
    visited[startGenY][startGenX] = true;
    
    while (stack.length > 0) {
        const current = stack.pop();
        const neighbors = [];
        const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
        
        for (const dir of dirs) {
            const nx = current.x + dir.x, ny = current.y + dir.y;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
                neighbors.push({ x: nx, y: ny, dir: dir });
            }
        }
        
        if (neighbors.length > 0) {
            stack.push(current);
            const { x: nx, y: ny, dir } = neighbors[Math.floor(Math.random() * neighbors.length)];
            if (dir.x === 1) vWalls[current.y][current.x + 1] = empty();
            else if (dir.x === -1) vWalls[current.y][current.x] = empty();
            else if (dir.y === 1) hWalls[current.y + 1][current.x] = empty();
            else if (dir.y === -1) hWalls[current.y][current.x] = empty();
            visited[ny][nx] = true;
            stack.push({ x: nx, y: ny });
        }
    }
    
    // 随机移除一些墙壁
    const wallsToRemove = Math.floor(width * height * 0.08);
    let removedCount = 0, attempts = 0;
    while (removedCount < wallsToRemove && attempts < wallsToRemove * 10) {
        attempts++;
        const rx = Math.floor(Math.random() * (width - 1));
        const ry = Math.floor(Math.random() * (height - 1));
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
    
    // 找到终点
    const endPos = findFarthestEndCell(startPos, width, height, hWalls, vWalls);
    
    // 随机添加一些门
    const doorProbability = 0.02;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const isNearEnd = (Math.abs(x - endPos.x) <= 1 && y === endPos.y) || 
                             (x === endPos.x && Math.abs(y - endPos.y) <= 1);
            if (y < height - 1 && !isPosInStartRoom(x, y, height) && 
                !isPosInStartRoom(x, y + 1, height) && !isNearEnd && 
                Math.random() < doorProbability) {
                hWalls[y + 1][x] = door();
            }
            if (x < width - 1 && !isPosInStartRoom(x, y, height) && 
                !isPosInStartRoom(x + 1, y, height) && !isNearEnd && 
                Math.random() < doorProbability) {
                vWalls[y][x + 1] = door();
            }
        }
    }
    
    // 在终点旁边放置锁门
    const lockedDoor = { type: WALL_TYPES.LOCKED, keys: 3 };
    const { x: ex, y: ey } = endPos;
    if (hWalls[ey][ex].type === WALL_TYPES.EMPTY) hWalls[ey][ex] = lockedDoor;
    else if (hWalls[ey + 1][ex].type === WALL_TYPES.EMPTY) hWalls[ey + 1][ex] = lockedDoor;
    else if (vWalls[ey][ex].type === WALL_TYPES.EMPTY) vWalls[ey][ex] = lockedDoor;
    else if (vWalls[ey][ex + 1].type === WALL_TYPES.EMPTY) vWalls[ey][ex + 1] = lockedDoor;
    
    // 生成鬼和钥匙
    const occupied = new Set();
    occupied.add(`${endPos.x},${endPos.y}`);
    for (let y = height - 3; y < height; y++) {
        for (let x = 0; x < 3; x++) {
            occupied.add(`${x},${y}`);
        }
    }
    
    // 放置鬼
    const initialGhosts = [];
    while (initialGhosts.length < ghostCount) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        const posKey = `${x},${y}`;
        if (!occupied.has(posKey)) {
            initialGhosts.push({ x, y, id: initialGhosts.length });
            occupied.add(posKey);
        }
    }
    
    // 放置钥匙（优先放在死角）
    const items = [];
    const keysToPlace = 4;
    const validCells = [], preferredCells = [];
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!occupied.has(`${x},${y}`)) {
                validCells.push({ x, y });
                let wallCount = 0;
                if (hWalls[y][x].type > 0) wallCount++;
                if (hWalls[y + 1][x].type > 0) wallCount++;
                if (vWalls[y][x].type > 0) wallCount++;
                if (vWalls[y][x + 1].type > 0) wallCount++;
                if (wallCount >= 3) preferredCells.push({ x, y });
            }
        }
    }
    
    for (let i = 0; i < keysToPlace; i++) {
        let pos = null;
        if (preferredCells.length > 0) {
            const index = Math.floor(Math.random() * preferredCells.length);
            pos = preferredCells.splice(index, 1)[0];
        } else if (validCells.length > 0) {
            const index = Math.floor(Math.random() * validCells.length);
            pos = validCells.splice(index, 1)[0];
        }
        if (pos) {
            items.push({ x: pos.x, y: pos.y, type: 'key' });
            const validIndex = validCells.findIndex(c => c.x === pos.x && c.y === pos.y);
            if (validIndex > -1) validCells.splice(validIndex, 1);
        }
    }
    
    // 创建活动单元格
    const activeCells = Array(height).fill(null).map(() => Array(width).fill(true));
    
    return {
        width,
        height,
        hWalls,
        vWalls,
        startPos,
        endPos,
        initialGhosts,
        items,
        buttons: [],
        activeCells,
        editorMode: 'regular',
        customStartPos: null,
        multiLayerMode: false,
        layerCount: 1,
        layers: [{
            hWalls,
            vWalls,
            activeCells,
            ghosts: initialGhosts,
            items,
            buttons: [],
            endPos,
            customStartPos: null
        }],
        stairs: []
    };
}
