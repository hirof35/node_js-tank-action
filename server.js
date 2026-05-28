const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};
let bullets = [];
let bulletId = 0;
let items = [];
let itemId = 0;
let itemSpawnTimer = 0;

// ─── 追加：難易度のパラメーター設定 ───
const DIFFICULTIES = {
    easy: { label: 'かんたん', moveSpeed: 1.0, cooldown: 1800, turnSpeed: 0.04 },
    normal: { label: 'ふつう', moveSpeed: 1.5, cooldown: 1200, turnSpeed: 0.1 },
    hard: { label: 'むずかしい', moveSpeed: 2.3, cooldown: 600, turnSpeed: 0.25 }
};
let currentDifficulty = 'normal'; // 初期値は「ふつう」

let bot = {
    id: 'BOT_ENEMY', x: 400, y: 300, angle: 0, color: '#ff0055',
    hp: 100, currentWeapon: 'cannon', lastShotTime: 0, targetAngle: 0, moveCooldown: 0
};

const TILE_SIZE = 50;
const MAP = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,0,0,1,1,1,1,0,0,1,1,0,1],
    [1,0,1,1,0,0,0,0,0,0,0,0,1,1,0,1],
    [1,0,0,0,0,1,1,0,0,1,1,0,0,0,0,1],
    [1,0,0,0,0,1,1,0,0,1,1,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,0,0,1,1,1,1,0,0,1,1,0,1],
    [1,0,1,1,0,0,0,0,0,0,0,0,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
];

const WEAPONS = {
    cannon: { name: '主砲', damage: 40, speed: 6, cooldown: 1200, radius: 6, color: '#ffcc00' },
    machinegun: { name: '機銃', damage: 8, speed: 10, cooldown: 150, radius: 3, color: '#ffffff' }
};

function checkWallCollision(x, y, radius) {
    const points = [
        {x: x - radius, y: y - radius}, {x: x + radius, y: y - radius},
        {x: x - radius, y: y + radius}, {x: x + radius, y: y + radius}
    ];
    for (let p of points) {
        const tileX = Math.floor(p.x / TILE_SIZE);
        const tileY = Math.floor(p.y / TILE_SIZE);
        if (tileY >= 0 && tileY < MAP.length && tileX >= 0 && tileX < MAP[0].length) {
            if (MAP[tileY][tileX] === 1) return true;
        }
    }
    return false;
}

function getRandomPosition() {
    let x, y;
    do {
        x = Math.random() * 700 + 50;
        y = Math.random() * 500 + 50;
    } while (checkWallCollision(x, y, 15));
    return { x, y };
}

const botStartPos = getRandomPosition();
bot.x = botStartPos.x;
bot.y = botStartPos.y;

function getAllEntities() {
    let all = { ...players };
    if (bot) {
        all[bot.id] = {
            x: bot.x, y: bot.y, angle: bot.angle, color: bot.color,
            hp: bot.hp, currentWeapon: bot.currentWeapon
        };
    }
    return all;
}

io.on('connection', (socket) => {
    console.log(`プレイヤーが接続しました: ${socket.id}`);

    const startPos = getRandomPosition();
    players[socket.id] = {
        x: startPos.x, y: startPos.y, angle: 0,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`, hp: 100,
        currentWeapon: 'cannon', lastShotTime: 0
    };

    // ─── 変更：現在の難易度（difficulty）もクライアントに送る ───
    socket.emit('init', { players: getAllEntities(), map: MAP, tileSize: TILE_SIZE, items: items, difficulty: currentDifficulty });
    io.emit('currentPlayers', getAllEntities());

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id] && players[socket.id].hp > 0) {
            if (!checkWallCollision(movementData.x, movementData.y, 14)) {
                players[socket.id].x = movementData.x;
                players[socket.id].y = movementData.y;
            }
            players[socket.id].angle = movementData.angle;
            io.emit('currentPlayers', getAllEntities());
        }
    });

    socket.on('switchWeapon', () => {
        const player = players[socket.id];
        if (player && player.hp > 0) {
            player.currentWeapon = player.currentWeapon === 'cannon' ? 'machinegun' : 'cannon';
            io.emit('currentPlayers', getAllEntities());
        }
    });

    // ─── 追加：難易度変更イベントの受信 ───
    socket.on('changeDifficulty', (level) => {
        if (DIFFICULTIES[level]) {
            currentDifficulty = level;
            // 全員に新しい難易度設定を通知
            io.emit('difficultyUpdated', currentDifficulty);
            console.log(`難易度が変更されました: ${DIFFICULTIES[level].label}`);
        }
    });

    socket.on('shoot', () => {
        const player = players[socket.id];
        if (!player || player.hp <= 0) return;

        const currentTime = Date.now();
        const weapon = WEAPONS[player.currentWeapon];

        if (currentTime - player.lastShotTime >= weapon.cooldown) {
            bullets.push({
                id: bulletId++, playerId: socket.id,
                x: player.x + Math.cos(player.angle) * 25,
                y: player.y + Math.sin(player.angle) * 25,
                angle: player.angle, speed: weapon.speed,
                damage: weapon.damage, radius: weapon.radius, color: weapon.color
            });
            player.lastShotTime = currentTime;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('currentPlayers', getAllEntities());
    });
});

function updateBotAI() {
    if (bot.hp <= 0) return;
    const currentTime = Date.now();

    // 現在の難易度パラメーターを取得
    const diffSetting = DIFFICULTIES[currentDifficulty];

    let closestPlayer = null;
    let minDistance = 300;

    for (let id in players) {
        if (players[id].hp <= 0) continue;
        const dx = players[id].x - bot.x;
        const dy = players[id].y - bot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) {
            minDistance = dist;
            closestPlayer = players[id];
        }
    }

    if (closestPlayer) {
        bot.targetAngle = Math.atan2(closestPlayer.y - bot.y, closestPlayer.x - bot.x);
        if (minDistance > 120) {
            // ─── 変更：難易度に応じた移動速度 ───
            let nextX = bot.x + Math.cos(bot.angle) * diffSetting.moveSpeed;
            let nextY = bot.y + Math.sin(bot.angle) * diffSetting.moveSpeed;
            if (!checkWallCollision(nextX, nextY, 14)) {
                bot.x = nextX; bot.y = nextY;
            }
        }

        const weapon = WEAPONS[bot.currentWeapon];
        // ─── 変更：主砲（cannon）の時だけ、難易度でクールダウン時間を変える ───
        const cooldownTime = bot.currentWeapon === 'cannon' ? diffSetting.cooldown : weapon.cooldown;

        if (currentTime - bot.lastShotTime >= cooldownTime) {
            if (Math.random() < 0.05) bot.currentWeapon = bot.currentWeapon === 'cannon' ? 'machinegun' : 'cannon';
            bullets.push({
                id: bulletId++, playerId: bot.id,
                x: bot.x + Math.cos(bot.angle) * 25, y: bot.y + Math.sin(bot.angle) * 25,
                angle: bot.angle, speed: weapon.speed,
                damage: weapon.damage, radius: weapon.radius, color: weapon.color
            });
            bot.lastShotTime = currentTime;
        }
    } else {
        bot.moveCooldown--;
        if (bot.moveCooldown <= 0) {
            bot.targetAngle = Math.random() * Math.PI * 2;
            bot.moveCooldown = Math.random() * 120 + 60;
        }
        // 徘徊時も難易度の速度を適用
        let nextX = bot.x + Math.cos(bot.angle) * (diffSetting.moveSpeed * 0.7);
        let nextY = bot.y + Math.sin(bot.angle) * (diffSetting.moveSpeed * 0.7);
        if (!checkWallCollision(nextX, nextY, 14)) {
            bot.x = nextX; bot.y = nextY;
        } else {
            bot.moveCooldown = 0;
        }
    }

    let angleDiff = bot.targetAngle - bot.angle;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    // ─── 変更：難易度に応じた旋回（エイム）速度 ───
    bot.angle += angleDiff * diffSetting.turnSpeed;
}

// ゲームループ（以降の処理はそのまま）
setInterval(() => {
    updateBotAI();
    let entities = getAllEntities();

    itemSpawnTimer++;
    if (itemSpawnTimer >= 60 * 5) {
        itemSpawnTimer = 0;
        if (items.length < 5) {
            const pos = getRandomPosition();
            items.push({ id: itemId++, x: pos.x, y: pos.y, radius: 10, type: 'heal' });
            io.emit('itemUpdate', items);
        }
    }

    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        for (let id in entities) {
            const entity = entities[id];
            if (entity.hp <= 0) continue;
            const dx = item.x - entity.x;
            const dy = item.y - entity.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 15 + item.radius) {
                if (id === bot.id) { bot.hp = Math.min(100, bot.hp + 50); } 
                else { players[id].hp = Math.min(100, players[id].hp + 50); }
                io.emit('explosion', { x: item.x, y: item.y, type: 'hit' });
                items.splice(i, 1);
                io.emit('itemUpdate', items);
                io.emit('currentPlayers', getAllEntities());
                break;
            }
        }
    }

    for (let b = bullets.length - 1; b >= 0; b--) {
        const bullet = bullets[b];
        bullet.x += Math.cos(bullet.angle) * bullet.speed;
        bullet.y += Math.sin(bullet.angle) * bullet.speed;

        let bulletRemoved = false;
        let type = 'wall';

        if (checkWallCollision(bullet.x, bullet.y, bullet.radius)) {
            bulletRemoved = true;
            type = 'wall';
        }

        if (!bulletRemoved) {
            for (let id in entities) {
                const entity = entities[id];
                if (bullet.playerId === id || entity.hp <= 0) continue;

                const dx = bullet.x - entity.x;
                const dy = bullet.y - entity.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 15 + bullet.radius) {
                    bulletRemoved = true;
                    if (id === bot.id) {
                        bot.hp -= bullet.damage;
                        type = bot.hp <= 0 ? 'kill' : 'hit';
                        if (bot.hp <= 0) {
                            setTimeout(() => {
                                bot.hp = 100;
                                const respawnPos = getRandomPosition();
                                bot.x = respawnPos.x; bot.y = respawnPos.y;
                                io.emit('currentPlayers', getAllEntities());
                            }, 3000);
                        }
                    } else {
                        players[id].hp -= bullet.damage;
                        type = players[id].hp <= 0 ? 'kill' : 'hit';
                        if (players[id].hp <= 0) {
                            setTimeout(() => {
                                if (players[id]) {
                                    players[id].hp = 100;
                                    const respawnPos = getRandomPosition();
                                    players[id].x = respawnPos.x; players[id].y = respawnPos.y;
                                    io.emit('currentPlayers', getAllEntities());
                                }
                            }, 2000);
                        }
                    }
                    break;
                }
            }
        }

        if (bulletRemoved) {
            io.emit('explosion', { x: bullet.x, y: bullet.y, type: type });
            bullets.splice(b, 1);
        }
    }

    io.emit('bulletUpdate', bullets);
}, 1000 / 60);

server.listen(3000, () => {
    console.log('サーバーがポート3000で起動しました。 http://localhost:3000');
});