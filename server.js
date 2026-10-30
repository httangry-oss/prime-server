const http = require('http');
const fs = require('fs');
const path = require('path');

// 진행 상태를 저장할 파일 경로
const STATE_FILE = path.join(__dirname, 'state.json');

let currentNumber = 2;
let stepCount = 0;
let nextChangeTime = Date.now() + 10000;
const clients = new Set();

// 1. 서버 시작 시 기존 저장 파일(state.json)이 있으면 불러오기
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

// 2. 현재 상태를 파일에 저장하는 함수 (비동기 저장으로 서버 멈춤 방지)
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

// 3. 서버가 꺼질 때 즉시 확실하게 저장하는 함수 (동기 방식)
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

// 소수 판별 및 다음 소수 계산
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

// 딜레이 설정 (첫 번째 값 '2'는 10분간 지속, 그 이후부터 점진적으로 가속)
function getDelay(step) {
    if (step === 0) {
        return 10 * 60 * 1000; // 정확히 10분 (600,000ms)
    }
    // step 1부터는 10초(10000ms)에서 출발해 점점 빨라짐 (최소 30ms 제한)
    return Math.max(30, 10000 * Math.exp(-(step - 1) / 50));
}

// 접속 중인 모든 클라이언트에게 현재 숫자 전송
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

// 메인 계산 루프
function serverLoop() {
    const delay = getDelay(stepCount);
    nextChangeTime = Date.now() + delay;

    broadcast();

    // 딜레이가 1초 이상일 때는 숫자가 바뀔 때마다 즉시 저장
    if (delay >= 1000) {
        saveStateAsync();
    }

    setTimeout(() => {
        currentNumber = getNextPrime(currentNumber);
        stepCount++;
        serverLoop();
    }, delay);
}

// 고속 구간 진입 시 디스크 무리를 줄이기 위해 1초마다 주기적으로 백업
setInterval(() => {
    saveStateAsync();
}, 1000);

// 터미널에서 Ctrl+C 로 끄거나 클라우드 서버가 재시작 신호(SIGTERM)를 보낼 때 마지막 숫자 즉시 저장
process.on('SIGINT', () => {
    saveStateSync();
    process.exit(0);
});
process.on('SIGTERM', () => {
    saveStateSync();
    process.exit(0);
});

// 웹 서버 설정
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('index.html 파일을 찾을 수 없습니다.');
                return;
            }
            // 💡 이 부분을 아래와 같이 세팅하면 브라우저가 정상적인 웹페이지로 인식합니다.
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.writeHead(200);
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

// 1) 이전 기록 불러오기 -> 2) 계산 루프 가동 -> 3) 서버 열기
loadState();
serverLoop();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버 가동 중: http://localhost:${PORT}`);
});