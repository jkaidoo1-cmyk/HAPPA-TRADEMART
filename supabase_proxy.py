import json
import os
import urllib.request
from urllib.error import HTTPError, URLError
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse, urlencode
from pathlib import Path

PORT = 9001
ROOT_DIR = Path(__file__).resolve().parent
os.chdir(ROOT_DIR)

SUPABASE_URL = "https://lifsgstqkkzhkbafuodp.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

def parse_query(query_string):
    parsed = parse_qs(query_string, keep_blank_values=True)
    return {k: v[0] for k, v in parsed.items()}

class BackendHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def supabase_request(self, method, path, params=None, data=None):
        url = f"{SUPABASE_URL}/rest/v1/{path}"
        
        # Build PostgREST query string
        if params and method == 'GET':
            postgrest_params = {}
            for k, v in params.items():
                if k == 'limit':
                    postgrest_params['limit'] = v
                elif k == 'page':
                    pass
                elif k == 'sort':
                    postgrest_params['order'] = f"{v}.desc"
                elif k == 'search':
                    # naive search across common fields
                    # We can't easily map the naive search to PostgREST without knowing columns.
                    pass
                else:
                    postgrest_params[k] = f"eq.{v}"
            if postgrest_params:
                url += "?" + urlencode(postgrest_params)
        
        # For single items (GET /api/table/id)
        if not params and method == 'GET' and '/' in path:
            table, item_id = path.split('/', 1)
            url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}"
            
        # For DELETE/PUT/PATCH (single items)
        if method in ('DELETE', 'PUT', 'PATCH') and '/' in path:
            table, item_id = path.split('/', 1)
            url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}"

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=representation"
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
            
        req = urllib.request.Request(url, method=method, headers=headers)
        if data is not None:
            req.data = json.dumps(data).encode('utf-8')
            
        try:
            with urllib.request.urlopen(req) as response:
                body = response.read().decode('utf-8')
                res_data = json.loads(body) if body else None
                # If it's a single item fetch, Supabase returns array, extract first element
                if method == 'GET' and '/' in path and isinstance(res_data, list):
                    res_data = res_data[0] if res_data else None
                # For GET with query, wrap in { data: [...] } to match frontend expectations
                if method == 'GET' and '/' not in path:
                    return {"data": res_data}
                return res_data
        except HTTPError as e:
            body = e.read().decode('utf-8')
            print(f"Supabase HTTPError {e.code}: {body}")
            raise Exception(body)
        except URLError as e:
            print(f"Supabase URLError: {e}")
            raise Exception(str(e))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            path = parsed.path[len('/api/'):]
            params = parse_query(parsed.query) if parsed.query else None
            try:
                result = self.supabase_request('GET', path, params)
                if result is None:
                    self.send_error_json(404, "Not Found")
                else:
                    self.send_json(result)
            except Exception as e:
                self.send_error_json(500, str(e))
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            path = parsed.path[len('/api/'):]
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length else b''
            data = json.loads(body.decode('utf-8')) if body else {}
            # Auto generate ID and dates if missing
            if 'id' not in data:
                import time, random
                data['id'] = f"{path[:3]}-{int(time.time()*1000)}-{random.randint(100,999)}"
            import datetime
            now = datetime.datetime.utcnow().isoformat() + "Z"
            if 'created_at' not in data: data['created_at'] = now
            data['updated_at'] = now
            
            try:
                result = self.supabase_request('POST', path, data=data)
                self.send_json(result[0] if isinstance(result, list) and result else result)
            except Exception as e:
                self.send_error_json(500, str(e))
        else:
            self.send_error(404, 'Not Found')

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            path = parsed.path[len('/api/'):]
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length else b''
            data = json.loads(body.decode('utf-8')) if body else {}
            import datetime
            data['updated_at'] = datetime.datetime.utcnow().isoformat() + "Z"
            
            try:
                result = self.supabase_request('PATCH', path, data=data)
                self.send_json(result[0] if isinstance(result, list) and result else result)
            except Exception as e:
                self.send_error_json(500, str(e))
        else:
            self.send_error(404, 'Not Found')
            
    def do_PATCH(self):
        self.do_PUT()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api'):
            path = parsed.path[len('/api/'):]
            try:
                result = self.supabase_request('DELETE', path)
                self.send_json({"success": True})
            except Exception as e:
                self.send_error_json(500, str(e))
        else:
            self.send_error(404, 'Not Found')

    def send_json(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def send_error_json(self, code, message):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'error': message}).encode('utf-8'))

if __name__ == '__main__':
    print(f"Starting backend proxy server on port {PORT}...")
    print("Connected to Supabase:", SUPABASE_URL)
    httpd = HTTPServer(('', PORT), BackendHandler)
    httpd.serve_forever()
