import { WALL_TYPES } from './constants.js';

// ==================================================
//  DataSerializer: 纯函数模块，处理分享码的序列化和反序列化
// ==================================================
export const DataSerializer = {
    /**
     * 生成【极致压缩】的分享码
     * @param {object} sourceData - 包含完整地图和游戏设置的对象
     * @returns {string|null} 生成的分享码或在失败时返回 null
     */
    generateShareCode(sourceData) {
        try {
            // 早期检测：确保压缩库 pako 已加载（从window获取，因为是CDN加载的）
            if (typeof window.pako === 'undefined') {
                console.error('generateShareCode: pako is not defined.');
                return { success: false, error: '压缩库未加载。' };
            }

            // 防御性校验与默认填充
            if (!Number.isInteger(sourceData.width) || !Number.isInteger(sourceData.height)) {
                return { success: false, error: '地图尺寸无效。' };
            }

            const buffer = [];
            
            // 2. 写入头部
            buffer.push(sourceData.width);
            buffer.push(sourceData.height);
            
            let modeByte = (sourceData.gameMode === 'exploration' ? 0 : 1);
            if (sourceData.editorMode === 'free') modeByte |= 2;
            if (sourceData.multiLayerMode) modeByte |= 4;
            buffer.push(modeByte);
            
            buffer.push(sourceData.initialHealth);
            buffer.push((sourceData.initialStamina >> 8) & 0xFF);
            buffer.push(sourceData.initialStamina & 0xFF);

            if (sourceData.endPos) {
                buffer.push(sourceData.endPos.x, sourceData.endPos.y);
            } else {
                buffer.push(0xFF, 0xFF);
            }

            const mapStart = sourceData.customStartPos || sourceData.startPos || { x: 1, y: (sourceData.height - 2) };
            buffer.push((mapStart && typeof mapStart.x === 'number') ? mapStart.x : 0xFF);
            buffer.push((mapStart && typeof mapStart.y === 'number') ? mapStart.y : 0xFF);
            const playerStartLayer = (typeof sourceData.playerStartLayer === 'number') ? sourceData.playerStartLayer : 0;
            buffer.push(playerStartLayer & 0xFF);

            if (sourceData.editorMode === 'free') {
                if (sourceData.customStartPos) {
                    buffer.push(sourceData.customStartPos.x, sourceData.customStartPos.y);
                } else {
                    buffer.push(0xFF, 0xFF);
                }
                let bits = 0, bitCount = 0;
                for(let y=0; y<sourceData.height; y++) {
                    for(let x=0; x<sourceData.width; x++) {
                        if (sourceData.activeCells[y][x]) bits |= (1 << bitCount);
                        bitCount++;
                        if (bitCount === 8) {
                            buffer.push(bits);
                            bits = 0;
                            bitCount = 0;
                        }
                    }
                }
                if (bitCount > 0) buffer.push(bits);
            }

            const pushEntities = (list, serializeFn) => {
                buffer.push(list.length);
                list.forEach(serializeFn);
            };
            pushEntities(sourceData.initialGhosts, g => buffer.push(g.x, g.y));
            pushEntities(sourceData.items, i => buffer.push(i.x, i.y));
            pushEntities(sourceData.buttons, b => {
                buffer.push(b.x, b.y);
                let dir = 0;
                if (b.direction.dy === -1) dir = 0;
                else if (b.direction.dy === 1) dir = 1;
                else if (b.direction.dx === -1) dir = 2;
                else dir = 3;
                buffer.push(dir);
                buffer.push(b.letter.charCodeAt(0));
            });

            const typeNibbles = [];
            const paramsQueue = [];
            const processWall = (wall) => {
                if (!wall) wall = { type: WALL_TYPES.EMPTY };
                const wt = (typeof wall.type === 'number') ? wall.type : WALL_TYPES.EMPTY;
                typeNibbles.push(wt);
                if (wt === WALL_TYPES.LOCKED) paramsQueue.push(wall.keys || 0);
                else if (wt === WALL_TYPES.ONE_WAY) {
                    let dir = 0;
                    if (wall.direction) {
                        if (wall.direction.dy === -1) dir = 0;
                        else if (wall.direction.dy === 1) dir = 1;
                        else if (wall.direction.dx === -1) dir = 2;
                        else dir = 3;
                    }
                    paramsQueue.push(dir);
                } else if (wt === WALL_TYPES.LETTER_DOOR) {
                    paramsQueue.push(wall.letter ? wall.letter.charCodeAt(0) : 0);
                    paramsQueue.push(wall.initialState === 'open' ? 1 : 0);
                }
            };

            for (let y = 0; y <= sourceData.height; y++) for (let x = 0; x < sourceData.width; x++) processWall(sourceData.hWalls[y][x]);
            for (let y = 0; y < sourceData.height; y++) for (let x = 0; x <= sourceData.width; x++) processWall(sourceData.vWalls[y][x]);

            for (let i = 0; i < typeNibbles.length; i += 2) {
                const t1 = typeNibbles[i];
                const t2 = (i + 1 < typeNibbles.length) ? typeNibbles[i + 1] : 0;
                buffer.push((t1 << 4) | t2);
            }
            paramsQueue.forEach(p => buffer.push(p));

            if (sourceData.multiLayerMode && sourceData.layers && sourceData.layers.length > 0) {
                buffer.push(sourceData.layerCount);
                const stairs = sourceData.stairs || [];
                buffer.push(stairs.length);
                stairs.forEach(s => {
                    buffer.push(s.x, s.y, s.layer);
                    buffer.push(s.direction === 'up' ? 0 : 1);
                });

                for (let layerIdx = 1; layerIdx < sourceData.layerCount; layerIdx++) {
                    const layer = sourceData.layers[layerIdx] || {};
                    let bits = 0, bitCount = 0;
                    for(let y = 0; y < sourceData.height; y++) {
                        for(let x = 0; x < sourceData.width; x++) {
                            const active = layer.activeCells && layer.activeCells[y] ? layer.activeCells[y][x] : true;
                            if (active) bits |= (1 << bitCount);
                            bitCount++;
                            if (bitCount === 8) { buffer.push(bits); bits = 0; bitCount = 0; }
                        }
                    }
                    if (bitCount > 0) buffer.push(bits);
                    
                    if (layer.customStartPos) buffer.push(layer.customStartPos.x, layer.customStartPos.y);
                    else buffer.push(0xFF, 0xFF);
                    
                    pushEntities(layer.ghosts || [], g => buffer.push(g.x, g.y));
                    pushEntities(layer.items || [], i => buffer.push(i.x, i.y));
                    
                    const layerTypeNibbles = [];
                    const layerParamsQueue = [];
                    const processLayerWall = (wall) => {
                        if (!wall) wall = { type: WALL_TYPES.EMPTY };
                        const wt = (typeof wall.type === 'number') ? wall.type : WALL_TYPES.EMPTY;
                        layerTypeNibbles.push(wt);
                        if (wt === WALL_TYPES.LOCKED) layerParamsQueue.push(wall.keys || 0);
                        else if (wt === WALL_TYPES.ONE_WAY) {
                            let dir = 0;
                            if (wall.direction) {
                                if (wall.direction.dy === -1) dir = 0; else if (wall.direction.dy === 1) dir = 1;
                                else if (wall.direction.dx === -1) dir = 2; else dir = 3;
                            }
                            layerParamsQueue.push(dir);
                        } else if (wt === WALL_TYPES.LETTER_DOOR) {
                            layerParamsQueue.push(wall.letter ? wall.letter.charCodeAt(0) : 0);
                            layerParamsQueue.push(wall.initialState === 'open' ? 1 : 0);
                        }
                    };
                    
                    for (let y = 0; y <= sourceData.height; y++) for (let x = 0; x < sourceData.width; x++) processLayerWall(layer.hWalls[y][x]);
                    for (let y = 0; y < sourceData.height; y++) for (let x = 0; x <= sourceData.width; x++) processLayerWall(layer.vWalls[y][x]);
                    
                    for (let i = 0; i < layerTypeNibbles.length; i += 2) {
                        const t1 = layerTypeNibbles[i];
                        const t2 = (i + 1 < layerTypeNibbles.length) ? layerTypeNibbles[i + 1] : 0;
                        buffer.push((t1 << 4) | t2);
                    }
                    layerParamsQueue.forEach(p => buffer.push(p));
                }
            }

            const uint8Data = new Uint8Array(buffer);
            const compressed = window.pako.deflateRaw(uint8Data);
            let binaryString = '';
            for (let i = 0; i < compressed.byteLength; i++) {
                binaryString += String.fromCharCode(compressed[i]);
            }
            const base64 = btoa(binaryString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            return { success: true, code: base64 };

        } catch (e) {
            console.error("generateShareCode: unexpected error", e);
            return { success: false, error: '生成分享码时发生未知错误。' };
        }
    },

    /**
     * 加载【极致压缩】的分享码
     * @param {string} code - 分享码字符串
     * @returns {object} 包含 { success, data } 或 { success, error } 的结果对象
     */
    loadFromShareCode(code) {
        if (!code) {
            return { success: false, error: '请输入分享码。' };
        }
        try {
            let base64 = code.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) { base64 += '='; }

            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const inflated = window.pako.inflateRaw(bytes);
            let ptr = 0;
            const read = () => inflated[ptr++];
            
            const width = read();
            const height = read();
            const modeByte = read();
            const gameMode = (modeByte & 1) === 0 ? 'exploration' : 'death-loop';
            const editorMode = (modeByte & 2) === 0 ? 'regular' : 'free';
            const multiLayerMode = (modeByte & 4) !== 0;
            
            const initialHealth = read();
            const initialStamina = (read() << 8) | read();

            const ex = read();
            const ey = read();
            const endPos = (ex !== 0xFF) ? { x: ex, y: ey } : null;

            let mapStartPos = null;
            let playerStartLayer = 0;
            if (ptr + 2 < inflated.length) { // 向后兼容检查
                const msx = read();
                const msy = read();
                if (msx !== 0xFF) mapStartPos = { x: msx, y: msy };
                playerStartLayer = read();
            }

            let customStartPos = null;
            let activeCells = editorMode === 'free' ? [] : Array(height).fill(null).map(() => Array(width).fill(true));

            if (editorMode === 'free') {
                const csx = read();
                const csy = read();
                if (csx !== 0xFF) customStartPos = { x: csx, y: csy };

                let bits = 0, bc = 8;
                for(let y=0; y<height; y++) {
                    const row = [];
                    for(let x=0; x<width; x++) {
                        if (bc === 8) { bits = read(); bc = 0; }
                        row.push((bits & (1 << bc)) !== 0);
                        bc++;
                    }
                    activeCells.push(row);
                }
            }

            const readEntities = (createFn) => {
                const count = read();
                const list = [];
                for(let i=0; i<count; i++) list.push(createFn());
                return list;
            };

            const initialGhosts = readEntities(() => ({ x: read(), y: read() }));
            const items = readEntities(() => ({ x: read(), y: read(), type: 'key' }));
            const buttons = readEntities(() => {
                const x = read(), y = read(), dirCode = read(), letter = String.fromCharCode(read());
                let direction = {dx:1, dy:0};
                if (dirCode === 0) direction = {dx:0, dy:-1};
                else if (dirCode === 1) direction = {dx:0, dy:1};
                else if (dirCode === 2) direction = {dx:-1, dy:0};
                return { x, y, direction, letter };
            });

            const totalWalls = (height + 1) * width + height * (width + 1);
            const packedBytesLen = Math.ceil(totalWalls / 2);
            const packedTypes = inflated.subarray(ptr, ptr + packedBytesLen);
            ptr += packedBytesLen;

            let wallCounter = 0;
            const getWallType = (index) => {
                const byteIndex = Math.floor(index / 2);
                const byte = packedTypes[byteIndex];
                return (index % 2 === 0) ? (byte >> 4) & 0x0F : byte & 0x0F;
            };

            const readNextWall = () => {
                const type = getWallType(wallCounter++);
                const wall = { type: type, keys: 0 };
                if (type === 3) wall.keys = read();
                else if (type === 4) {
                    const d = read();
                    if (d === 0) wall.direction = {dx:0, dy:-1}; else if (d === 1) wall.direction = {dx:0, dy:1};
                    else if (d === 2) wall.direction = {dx:-1, dy:0}; else wall.direction = {dx:1, dy:0};
                } else if (type === 6) {
                    wall.letter = String.fromCharCode(read());
                    wall.initialState = read() === 1 ? 'open' : 'closed';
                    wall.currentState = wall.initialState;
                }
                return wall;
            };

            const hWalls = Array.from({ length: height + 1 }, () => Array.from({ length: width }, readNextWall));
            const vWalls = Array.from({ length: height }, () => Array.from({ length: width + 1 }, readNextWall));
            
            let layerCount = 1;
            let stairs = [];
            let layers = [];
            
            if (multiLayerMode && ptr < inflated.length) {
                layerCount = read();
                stairs = readEntities(() => ({ x: read(), y: read(), layer: read(), direction: read() === 0 ? 'up' : 'down' }));
                
                layers.push({ hWalls, vWalls, activeCells, ghosts: initialGhosts, items, buttons, stairs: stairs.filter(s => s.layer === 0), endPos, customStartPos });
                
                for (let layerIdx = 1; layerIdx < layerCount; layerIdx++) {
                    const layerActiveCells = [];
                    let bits = 0, bc = 8;
                    for(let y = 0; y < height; y++) {
                        const row = [];
                        for(let x = 0; x < width; x++) {
                            if (bc === 8) { bits = read(); bc = 0; }
                            row.push((bits & (1 << bc)) !== 0);
                            bc++;
                        }
                        layerActiveCells.push(row);
                    }
                    
                    const lcsx = read(), lcsy = read();
                    const layerCustomStartPos = lcsx !== 0xFF ? { x: lcsx, y: lcsy } : null;
                    
                    const layerGhosts = readEntities(() => ({ x: read(), y: read() }));
                    const layerItems = readEntities(() => ({ x: read(), y: read(), type: 'key' }));
                    
                    const layerPackedBytesLen = Math.ceil(totalWalls / 2);
                    const layerPackedTypes = inflated.subarray(ptr, ptr + layerPackedBytesLen);
                    ptr += layerPackedBytesLen;
                    
                    let layerWallCounter = 0;
                    const getLayerWallType = (index) => {
                        const byteIndex = Math.floor(index / 2);
                        const byte = layerPackedTypes[byteIndex];
                        return (index % 2 === 0) ? (byte >> 4) & 0x0F : byte & 0x0F;
                    };
                    
                    const readNextLayerWall = () => {
                        const type = getLayerWallType(layerWallCounter++);
                        const wall = { type: type, keys: 0 };
                        if (type === 3) wall.keys = read();
                        else if (type === 4) {
                            const d = read();
                            if (d === 0) wall.direction = {dx:0, dy:-1}; else if (d === 1) wall.direction = {dx:0, dy:1};
                            else if (d === 2) wall.direction = {dx:-1, dy:0}; else wall.direction = {dx:1, dy:0};
                        } else if (type === 6) {
                            wall.letter = String.fromCharCode(read());
                            wall.initialState = read() === 1 ? 'open' : 'closed';
                            wall.currentState = wall.initialState;
                        }
                        return wall;
                    };
                    
                    const layerHWalls = Array.from({ length: height + 1 }, () => Array.from({ length: width }, readNextLayerWall));
                    const layerVWalls = Array.from({ length: height }, () => Array.from({ length: width + 1 }, readNextLayerWall));
                    
                    layers.push({ hWalls: layerHWalls, vWalls: layerVWalls, activeCells: layerActiveCells, ghosts: layerGhosts, items: layerItems, buttons: [], stairs: stairs.filter(s => s.layer === layerIdx), endPos: null, customStartPos: layerCustomStartPos });
                }
            }

            const mapData = { width, height, hWalls, vWalls, endPos, initialGhosts, items, buttons, editorMode, customStartPos, activeCells, multiLayerMode, layerCount, layers, stairs, mapStartPos, playerStartLayer };
            
            return { success: true, data: { mapData, gameMode, initialHealth, initialStamina } };

        } catch (e) {
            console.error("Load failed", e);
            return { success: false, error: '分享码无效或已损坏。' };
        }
    }
};
