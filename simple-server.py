# Fullstack Python backend for HAPPA TRADEMART
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = 9000
ROOT_DIR = Path(__file__).resolve().parent
DB_FILE = ROOT_DIR / 'db.json'

os.chdir(ROOT_DIR)


def load_db():
    if not DB_FILE.exists():
        save_db(seed_db())
    try:
        with DB_FILE.open('r', encoding='utf-8') as fh:
            return json.load(fh)
    except Exception as exc:
        print('Failed to read db.json:', exc)
        data = seed_db()
        save_db(data)
        return data


def save_db(data):
    with DB_FILE.open('w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)


def generate_id(table):
    return f"{table[:3]}-{int(os.times().system * 1000)}-{os.urandom(2).hex()}"


def parse_query(query):
    parsed = parse_qs(query, keep_blank_values=True)
    return {k: v[0] for k, v in parsed.items()}


def matches_search(record, search):
    needle = str(search or '').strip().lower()
    if not needle:
        return True
    for value in record.values():
        if value is None:
            continue
        if isinstance(value, list):
            text = ' '.join(str(x) for x in value)
        else:
            text = str(value)
        if needle in text.lower():
            return True
    return False


def apply_filters(records, params):
    result = list(records)
    search = params.pop('search', None)
    limit = params.pop('limit', None)
    page = params.pop('page', None)
    sort = params.pop('sort', None)

    if search is not None:
        result = [item for item in result if matches_search(item, search)]

    for key, value in params.items():
        if value == '':
            continue
        result = [item for item in result if str(item.get(key, '')).lower() == value.lower()]

    if sort:
        result.sort(key=lambda item: item.get(sort) if item.get(sort) is not None else '', reverse=True)

    try:
        max_items = int(limit) if limit else None
    except ValueError:
        max_items = None

    page_num = 1
    try:
        page_num = int(page) if page else 1
    except ValueError:
        page_num = 1

    if max_items and max_items > 0:
        start = (page_num - 1) * max_items
        result = result[start:start + max_items]

    return result


class BackendHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            self.handle_api_get(parsed)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            self.handle_api_write(parsed, method='POST')
        else:
            self.send_error(404, 'Not Found')

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            self.handle_api_write(parsed, method='PUT')
        else:
            self.send_error(404, 'Not Found')

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            self.handle_api_write(parsed, method='PATCH')
        else:
            self.send_error(404, 'Not Found')

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            self.handle_api_delete(parsed)
        else:
            self.send_error(404, 'Not Found')

    def handle_api_get(self, parsed):
        db = load_db()
        path = parsed.path[len('/api'):].strip('/')
        if not path:
            self.send_json({'status': 'ok', 'version': '1.0.0'})
            return

        segments = path.split('/')
        table = segments[0]
        params = parse_query(parsed.query)
        records = db.get(table, [])

        if len(segments) == 1:
            self.send_json({'data': apply_filters(records, params)})
            return

        item_id = segments[1]
        item = next((item for item in records if str(item.get('id')) == item_id), None)
        if item is None:
            self.send_error_json(404, 'Record not found')
            return
        self.send_json(item)

    def handle_api_write(self, parsed, method):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b''
        try:
            data = json.loads(body.decode('utf-8')) if body else {}
        except Exception:
            self.send_error_json(400, 'Invalid JSON body')
            return

        db = load_db()
        path = parsed.path[len('/api'):].strip('/')
        if not path:
            self.send_error_json(400, 'Table name required')
            return

        segments = path.split('/')
        table = segments[0]
        records = db.setdefault(table, [])

        if method == 'POST':
            new_id = str(data.get('id') or generate_id(table))
            data['id'] = new_id
            records.append(data)
            save_db(db)
            self.send_json(data, status=201)
            return

        if len(segments) != 2:
            self.send_error_json(400, 'Record ID required')
            return

        item_id = segments[1]
        index = next((i for i, item in enumerate(records) if str(item.get('id')) == item_id), None)
        if index is None:
            self.send_error_json(404, 'Record not found')
            return

        if method == 'PUT':
            data['id'] = item_id
            records[index] = data
        else:  # PATCH
            records[index].update(data)
            records[index]['id'] = item_id

        save_db(db)
        self.send_json(records[index])

    def handle_api_delete(self, parsed):
        db = load_db()
        path = parsed.path[len('/api'):].strip('/')
        segments = path.split('/')
        if len(segments) != 2:
            self.send_error_json(400, 'Record ID required')
            return
        table = segments[0]
        item_id = segments[1]
        records = db.get(table, [])
        index = next((i for i, item in enumerate(records) if str(item.get('id')) == item_id), None)
        if index is None:
            self.send_error_json(404, 'Record not found')
            return
        records.pop(index)
        save_db(db)
        self.send_response(204)
        self.end_headers()

    def send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, status, message):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps({'error': message}).encode('utf-8'))


def seed_db():
    return {
        'users': [],
        'stores': [],
        'products': [],
        'orders': [],
        'packages': [],
        'services': [],
        'wallet_transactions': [],
        'notifications': [],
        'ad_campaigns': [],
        'settings': [],
        'referrals': [],
        'delivery_rates': [],
        'reviews': [],
        'service_orders': []
    }


if __name__ == '__main__':
    print(f'[OK] Python backend running at http://localhost:{PORT}/')
    try:
        server = HTTPServer(('0.0.0.0', PORT), BackendHandler)
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        server.server_close()
