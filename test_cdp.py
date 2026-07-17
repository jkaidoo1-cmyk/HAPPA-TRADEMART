import subprocess
import time
import os
import urllib.request
import urllib.parse
import json
import socket
import select
import threading

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
    frame.extend(b"\x00\x00\x00\x00")
    frame.extend(payload)
    s.sendall(frame)

try:
    with urllib.request.urlopen("http://localhost:9222/json") as response:
        targets = json.loads(response.read().decode())
    ws_url = None
    for t in targets:
        if t.get('type') == 'page' and 'localhost:8080' in t.get('url', ''):
            ws_url = t.get('webSocketDebuggerUrl')
            break
            
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

    # Start a thread to read and write to a file continuously
    s.setblocking(False)
    data_buffer = b""
    stop_read = False
    def reader():
        global data_buffer
        while not stop_read:
            ready = select.select([s], [], [], 0.5)
            if ready[0]:
                try:
                    chunk = s.recv(4096)
                    if not chunk: break
                    data_buffer += chunk
                except:
                    break
    t = threading.Thread(target=reader)
    t.start()

    send_frame(s, json.dumps({"id": 1, "method": "Log.enable"}))
    send_frame(s, json.dumps({"id": 2, "method": "Runtime.enable"}))
    
    time.sleep(1)

    click_script = """
    const cards = document.querySelectorAll('.product-card');
    if (cards.length > 0) {
        cards[0].click();
        'Clicked product card';
    } else {
        'No product cards found';
    }
    """
    send_frame(s, json.dumps({"id": 3, "method": "Runtime.evaluate", "params": {"expression": click_script}}))
    time.sleep(2)
    
    html_script = "document.getElementById('page-product').innerHTML"
    send_frame(s, json.dumps({"id": 4, "method": "Runtime.evaluate", "params": {"expression": html_script}}))
    time.sleep(1)

    stop_read = True
    t.join()

    with open("ws_output.bin", "wb") as f:
        f.write(data_buffer)
    print("Done. Wrote", len(data_buffer), "bytes.")

finally:
    process.terminate()
