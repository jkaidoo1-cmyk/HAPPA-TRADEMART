# Simple PowerShell HTTP Server for Happa Project
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:9000/')
$listener.Start()
Write-Host "✅ Server is running at: http://localhost:9000/"
Write-Host "Press Ctrl+C to stop."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # Get the requested path
        $url = $request.Url.LocalPath
        if ($url -eq '/') {
            $url = '/index.html'
        }

        # Build the full file path
        $filePath = Join-Path $PSScriptRoot $url.TrimStart('/')
        Write-Host "Request: $url -> $filePath"

        # Determine MIME type
        $extension = [System.IO.Path]::GetExtension($filePath)
        $mimeType = 'text/html'
        $mimeTypes = @{
            '.html' = 'text/html'
            '.js'   = 'text/javascript'
            '.css'  = 'text/css'
            '.json' = 'application/json'
            '.png'  = 'image/png'
            '.jpg'  = 'image/jpeg'
            '.jpeg' = 'image/jpeg'
            '.gif'  = 'image/gif'
            '.svg'  = 'image/svg+xml'
            '.ico'  = 'image/x-icon'
        }
        if ($mimeTypes.ContainsKey($extension)) {
            $mimeType = $mimeTypes[$extension]
        }

        # Serve the file
        if ([System.IO.File]::Exists($filePath)) {
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $mimeType
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
            Write-Host "Served: $url (200 OK)"
        } else {
            $response.StatusCode = 404
            $errorMessage = "<html><body><h1>404 Not Found</h1><p>Could not find: $url</p></body></html>"
            $errorBytes = [System.Text.Encoding]::UTF8.GetBytes($errorMessage)
            $response.ContentType = 'text/html'
            $response.ContentLength64 = $errorBytes.Length
            $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
            Write-Host "Not Found: $url"
        }

        $response.Close()
    }
} finally {
    $listener.Stop()
    Write-Host "Server stopped."
}
