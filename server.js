const http = require('http');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

let currentNumber = 2;
let stepCount = 0;
let nextChangeTime = Date.now() + 10000;
const clients = new Set();

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const rawData = fs.readFileSync(STATE_FILE, 'utf-8');
            const saved = JSON.parse(rawData);
            if (saved && typeof saved.currentNumber === 'number' && typeof saved.stepCount === 'number') {
                currentNumber = saved.currentNumber;
                stepCount = saved.stepCount;
                console.log(`[복구 완료] 이전 기록을 불러왔습니다: ${stepCount + 1}번째 소수 (${currentNumber.toLocaleString()})부터 이어서 시작합니다.`);
                return;
            }
        }
    } catch (err) {
        console.error('[복구 실패] 상태 파일을 읽는 중 오류가 발생해 처음(2)부터 시작합니다:', err);
    }
    console.log('[최초 시작] 저장된 기록이 없어 첫 번째 소수(2)부터 새로 시작합니다.');
}

let isSaving = false;
function saveStateAsync() {
    if (isSaving) return;
    isSaving = true;
    const data = JSON.stringify({
        currentNumber,
        stepCount,
        updatedAt: new Date().toISOString()
    });
    fs.writeFile(STATE_FILE, data, 'utf-8', (err) => {
        isSaving = false;
        if (err) console.error('상태 저장 오류:', err);
    });
}

function saveStateSync() {
    try {
        const data = JSON.stringify({
            currentNumber,
            stepCount,
            updatedAt: new Date().toISOString()
        });
        fs.writeFileSync(STATE_FILE, data, 'utf-8');
        console.log(`\n[안전 저장 완료] 마지막 상태(${currentNumber.toLocaleString()})가 state.json에 저장되었습니다.`);
    } catch (err) {
        console.error('종료 시 저장 오류:', err);
    }
}

function isPrime(num) {
    if (num < 2) return false;
    if (num === 2) return true;
    if (num % 2 === 0) return false;
    const limit = Math.sqrt(num);
    for (let i = 3; i <= limit; i += 2) {
        if (num % i === 0) return false;
    }
    return true;
}

function getNextPrime(num) {
    if (num === 2) return 3;
    let next = num + 2;
    while (!isPrime(next)) {
        next += 2;
    }
    return next;
}

function getDelay(step) {
    if (step === 0) {
        return 10 * 60 * 1000; // 첫 2는 10분 지속
    }
    return Math.max(30, 10000 * Math.exp(-(step - 1) / 50));
}

function broadcast() {
    const payload = JSON.stringify({
        number: currentNumber,
        step: stepCount,
        nextChangeTime: nextChangeTime
    });
    for (const res of clients) {
        res.write(`data: ${payload}\n\n`);
    }
}

function serverLoop() {
    const delay = getDelay(stepCount);
    nextChangeTime = Date.now() + delay;

    broadcast();

    if (delay >= 1000) {
        saveStateAsync();
    }

    setTimeout(() => {
        currentNumber = getNextPrime(currentNumber);
        stepCount++;
        serverLoop();
    }, delay);
}

setInterval(() => {
    saveStateAsync();
}, 1000);

process.on('SIGINT', () => {
    saveStateSync();
    process.exit(0);
});
process.on('SIGTERM', () => {
    saveStateSync();
    process.exit(0);
});

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('index.html 파일을 읽어오지 못했습니다.');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
    } else if (req.url === '/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const initialPayload = JSON.stringify({
            number: currentNumber,
            step: stepCount,
            nextChangeTime: nextChangeTime
        });
        res.write(`data: ${initialPayload}\n\n`);

        clients.add(res);

        req.on('close', () => {
            clients.delete(res);
        });
    }
});

loadState();
serverLoop();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버 가동 중: http://localhost:${PORT}`);
});
