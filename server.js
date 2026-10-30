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

// HTML 화면을 코드 내부에 직접 포함시켜 경로 문제 원천 차단
const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prime Live Server</title>
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@700&display=swap" rel="stylesheet">
    <style>
        body {
            background-color: #0d1117;
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            font-family: 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace;
        }
        #result {
            font-size: 10vw;
            font-weight: bold;
            color: #ffffff;
            text-shadow: 0 0 30px rgba(255, 255, 255, 0.4);
            text-align: center;
        }
        #timer {
            margin-top: 20px;
            font-size: 1.5rem;
            color: #8b949e;
        }
    </style>
</head>
<body>
    <div id="result">연결 중...</div>
    <div id="timer">서버에서 실시간 데이터를 받아오고 있습니다</div>

    <script>
        const resultDiv = document.getElementById('result');
        const timerDiv = document.getElementById('timer');
        let targetTime = 0;
        let currentStep = 0;

        const evtSource = new EventSource('/stream');

        evtSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            resultDiv.textContent = data.number.toLocaleString();
            targetTime = data.nextChangeTime;
            currentStep = data.step;
        };

        function updateTimerUI() {
            if (targetTime > 0) {
                const remaining = Math.max(0, targetTime - Date.now());
                if (remaining > 100 && currentStep < 150) {
                    timerDiv.textContent = \`다음 숫자까지: \${(remaining / 1000).toFixed(1)}초 (\${(currentStep + 1).toLocaleString()}번째 소수)\`;
                } else {
                    timerDiv.textContent = \`서버 실시간 중계 중 (\${(currentStep + 1).toLocaleString()}번째 소수)\`;
                }
            }
            requestAnimationFrame(updateTimerUI);
        }

        requestAnimationFrame(updateTimerUI);
    </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlContent);
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
server.listen(PORT, () => { console.log(`서버 가동 중: http://localhost:${PORT}`); 
});
