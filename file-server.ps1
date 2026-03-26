# iMedic File Server - PowerShell HTTP Server
# No requiere Node.js ni dependencias adicionales

$port = 3002
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "iMedic File Server - PowerShell" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Puerto: $port" -ForegroundColor Yellow
Write-Host "Endpoints:" -ForegroundColor Yellow
Write-Host "  - GET /health" -ForegroundColor White
Write-Host "  - GET /file?path=E:\adjuntos\archivo.pdf" -ForegroundColor White
Write-Host ""
Write-Host "Presiona Ctrl+C para detener" -ForegroundColor Gray
Write-Host ""

function Normalize-Path {
    param([string]$path)
    
    # Mapear D:\ a E:\
    if ($path -like "D:\*") {
        $path = $path -replace "^D:\\", "E:\"
    }
    
    # Mapear F:\ a E:\
    if ($path -like "F:\*") {
        $path = $path -replace "^F:\\", "E:\"
    }
    
    return $path
}

function Get-MimeType {
    param([string]$extension)
    
    $mimeTypes = @{
        ".pdf"  = "application/pdf"
        ".jpg"  = "image/jpeg"
        ".jpeg" = "image/jpeg"
        ".png"  = "image/png"
        ".gif"  = "image/gif"
        ".doc"  = "application/msword"
        ".docx" = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
    
    if ($mimeTypes.ContainsKey($extension)) {
        return $mimeTypes[$extension]
    }
    
    return "application/octet-stream"
}

function Send-JsonResponse {
    param(
        [System.Net.HttpListenerResponse]$response,
        [hashtable]$data,
        [int]$statusCode = 200
    )
    
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    
    $json = $data | ConvertTo-Json -Compress
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentLength64 = $buffer.Length
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()
}

function Send-FileResponse {
    param(
        [System.Net.HttpListenerResponse]$response,
        [string]$filePath
    )
    
    try {
        $normalizedPath = Normalize-Path -path $filePath
        
        Write-Host "📂 Solicitando: $filePath" -ForegroundColor Cyan
        if ($normalizedPath -ne $filePath) {
            Write-Host "🔄 Normalizado: $normalizedPath" -ForegroundColor Yellow
        }
        
        if (-not (Test-Path $normalizedPath)) {
            Write-Host "❌ No encontrado: $normalizedPath" -ForegroundColor Red
            Send-JsonResponse -response $response -data @{
                success = $false
                error = "Archivo no encontrado"
                path = $normalizedPath
            } -statusCode 404
            return
        }
        
        $fileInfo = Get-Item $normalizedPath
        $extension = $fileInfo.Extension.ToLower()
        $mimeType = Get-MimeType -extension $extension
        
        $response.StatusCode = 200
        $response.ContentType = $mimeType
        $response.ContentLength64 = $fileInfo.Length
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Content-Disposition", "inline; filename=`"$($fileInfo.Name)`"")
        
        $fileStream = [System.IO.File]::OpenRead($normalizedPath)
        $fileStream.CopyTo($response.OutputStream)
        $fileStream.Close()
        $response.OutputStream.Close()
        
        Write-Host "✅ Enviado: $normalizedPath ($($fileInfo.Length) bytes)" -ForegroundColor Green
        
    } catch {
        Write-Host "❌ Error: $_" -ForegroundColor Red
        Send-JsonResponse -response $response -data @{
            success = $false
            error = "Error al servir archivo"
            details = $_.Exception.Message
        } -statusCode 500
    }
}

# Loop principal
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $url = $request.Url.LocalPath
        $query = $request.QueryString
        
        Write-Host "$(Get-Date -Format 'HH:mm:ss') - $($request.HttpMethod) $url" -ForegroundColor White
        
        # Endpoint: /health
        if ($url -eq "/health") {
            Send-JsonResponse -response $response -data @{
                success = $true
                status = "OK"
                timestamp = (Get-Date).ToString("o")
                server = "iMedic File Server (PowerShell)"
            }
            continue
        }
        
        # Endpoint: /file?path=...
        if ($url -eq "/file") {
            $filePath = $query["path"]
            
            if ([string]::IsNullOrEmpty($filePath)) {
                Send-JsonResponse -response $response -data @{
                    success = $false
                    error = "Parámetro 'path' es requerido"
                } -statusCode 400
                continue
            }
            
            Send-FileResponse -response $response -filePath $filePath
            continue
        }
        
        # Endpoint no encontrado
        Send-JsonResponse -response $response -data @{
            success = $false
            error = "Endpoint no encontrado"
            path = $url
        } -statusCode 404
        
    } catch {
        Write-Host "❌ Error en request: $_" -ForegroundColor Red
        try {
            $response.StatusCode = 500
            $response.Close()
        } catch {}
    }
}

$listener.Stop()
Write-Host "Servidor detenido" -ForegroundColor Yellow
