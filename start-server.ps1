# Simple HTTP Server
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:9000/")
$listener.Start()
Write-Host "Server running at http://localhost:9000/"
Write-Host "Press Ctrl+C to stop..."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $url = $request.Url.LocalPath
    if ($url -eq "/") { $url = "/index.html" }
    $filePath = Join-Path $PSScriptRoot $url.TrimStart("/")

    $contentType = "text/html"
    $ext = [System.IO.Path]::GetExtension($filePath)
    switch ($ext) {
      ".js"  { $contentType = "text/javascript" }
      ".css" { $contentType = "text/css" }
      ".json" { $contentType = "application/json" }
      ".png" { $contentType = "image/png" }
      ".jpg" { $contentType = "image/jpeg" }
      ".jpeg" { $contentType = "image/jpeg" }
      ".gif" { $contentType = "image/gif" }
      ".svg" { $contentType = "image/svg+xml" }
      ".ico" { $contentType = "image/x-icon" }
    }

    if ([System.IO.File]::Exists($filePath)) {
      $content = [System.IO.File]::ReadAllBytes($filePath)
      $response.ContentType = $contentType
      $response.ContentLength64 = $content.Length
      $response.OutputStream.Write($content, 0, $content.Length)
    } else {
      $response.StatusCode = 404
      $message = [System.Text.Encoding]::UTF8.GetBytes("<h1>404 Not Found</h1>")
      $response.ContentLength64 = $message.Length
      $response.OutputStream.Write($message, 0, $message.Length)
    }
    $response.Close()
  }
} finally {
  $listener.Stop()
}
