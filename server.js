const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);

// 정적 파일(HTML 등)을 서빙하기 위한 설정
app.use(express.static(path.join(__dirname)));

let currentNumber = 2;
let stepCount = 0;
let nextChangeTime = Date.now() + 1000;

const clients = new Set();

function loadState() {
    // 상태 로드 로직
}

function serverLoop() {
    // 서버 루프 로직
}

// 실시간 데이터 스트리밍 통로 설정
app.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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
});

loadState();
serverLoop();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`서버 가동 중: http://localhost:${PORT}`); });
