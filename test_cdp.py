import subprocess
import time
import os
import urllib.request
import urllib.parse
import json
import socket
import select
import random

chrome_paths = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
chrome_path = None
for path in chrome_paths:
    if os.path.exists(path):
        chrome_path = path
        break

cmd = [
    chrome_path,
    "--headless=new",
    "--remote-debugging-port=9222",
    "http://localhost:8080/"
]
process = subprocess.Popen(cmd)
time.sleep(4)

def parse_frame(data):
    if len(data) < 2: return None, data
    fin = data[0] & 128
    opcode = data[0] & 15
    masked = data[1] & 128
    payload_len = data[1] & 127
    
    idx = 2
    if payload_len == 126:
        if len(data) < 4: return None, data
        payload_len = (data[2] << 8) | data[3]
        idx = 4
    elif payload_len == 127:
        if len(data) < 10: return None, data
        payload_len = 0
        for i in range(8):
            payload_len = (payload_len << 8) | data[2+i]
        idx = 10
        
    mask_key = None
    if masked:
        if len(data) < idx + 4: return None, data
        mask_key = data[idx:idx+4]
        idx += 4
        
    if len(data) < idx + payload_len: return None, data
        
    payload = data[idx:idx+payload_len]
    if masked:
        payload = bytearray(payload)
        for i in range(len(payload)):
            payload[i] ^= mask_key[i % 4]
            
    rest = data[idx+payload_len:]
    return payload.decode('utf-8', errors='ignore'), rest

def send_frame(s, text):
    payload = text.encode('utf-8')
    frame = bytearray()
    frame.append(129)
    length = len(payload)
    if length <= 125:
        frame.append(length | 128)
    elif length <= 65535:
        frame.append(126 | 128)
        frame.append((length >> 8) & 255)
        frame.append(length & 255)
    else:
        frame.append(127 | 128)
        for i in range(7, -1, -1):
            frame.append((length >> (i * 8)) & 255)
            
    mask_key = [random.randint(0, 255) for _ in range(4)]
    frame.extend(mask_key)
    
    masked_payload = bytearray(len(payload))
    for i in range(len(payload)):
        masked_payload[i] = payload[i] ^ mask_key[i % 4]
        
    frame.extend(masked_payload)
    s.sendall(frame)

def recv_all_frames(s, timeout=1.0):
    s.setblocking(False)
    data = b""
    end = time.time() + timeout
    frames = []
    while time.time() < end:
        ready = select.select([s], [], [], 0.1)
        if ready[0]:
            try:
                chunk = s.recv(8192)
                if not chunk: break
                data += chunk
                while True:
                    msg, data = parse_frame(data)
                    if msg is None: break
                    frames.append(msg)
            except Exception as e:
                pass
    s.setblocking(True)
    return frames

try:
    with urllib.request.urlopen("http://localhost:9222/json") as response:
        targets = json.loads(response.read().decode())
    ws_url = None
    for t in targets:
        if t.get('type') == 'page' and 'localhost:8080' in t.get('url', ''):
            ws_url = t.get('webSocketDebuggerUrl')
            break
            
    if ws_url:
        parsed = urllib.parse.urlparse(ws_url)
        host = parsed.netloc
        path = parsed.path
        
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect((host.split(':')[0], int(host.split(':')[1])))
        
        handshake = f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: YW55IHJhbmRvbSBrZXk=\r\nSec-WebSocket-Version: 13\r\n\r\n"
        s.sendall(handshake.encode())
        
        resp = b""
        while b"\r\n\r\n" not in resp:
            resp += s.recv(1024)

        recv_all_frames(s, 0.5)

        send_frame(s, json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": "document.querySelectorAll('.product-card').length"}}))
        print("Count:", recv_all_frames(s, 1.0))

        click_script = """
        const cards = document.querySelectorAll('.product-card');
        if (cards.length > 0) {
            cards[0].click();
            'Clicked';
        } else {
            'No cards';
        }
        """
        send_frame(s, json.dumps({"id": 2, "method": "Runtime.evaluate", "params": {"expression": click_script}}))
        print("Click:", recv_all_frames(s, 1.0))
        
        time.sleep(1)

        html_script = "document.getElementById('page-product').innerHTML"
        send_frame(s, json.dumps({"id": 3, "method": "Runtime.evaluate", "params": {"expression": html_script}}))
        
        res = recv_all_frames(s, 1.0)
        with open("html_out.txt", "w", encoding="utf-8") as f:
            f.write(json.dumps(res, indent=2))
        print("Done. Wrote html_out.txt")

finally:
    process.terminate()
