#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os

PORT = 9002

os.chdir(os.path.dirname(os.path.abspath(__file__)))

print("Static server running at http://localhost:%d" % PORT)
HTTPServer(('', PORT), SimpleHTTPRequestHandler).serve_forever()
