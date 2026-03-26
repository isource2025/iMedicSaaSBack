# iMedic File Server - PowerShell HTTP Server
# No requiere Node.js ni dependencias adicionales

# Cargar ensamblado para decodificación de URLs
Add-Type -AssemblyName System.Web

$port = 3002
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")
$listener.Start()

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "iMedic File Server - PowerShell" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Puerto: $port" -ForegroundColor Yellow
Write-Host "Endpoints:" -ForegroundColor Yellow
Write-Host "  - GET /health" -ForegroundColor White
Write-Host "  - GET /file?path=E:\adjuntos\archivo.pdf" -ForegroundColor White
Write-Host "  - POST /upload (multipart/form-data)" -ForegroundColor White
Write-Host ""
Write-Host "Presiona Ctrl+C para detener" -ForegroundColor Gray
Write-Host ""

function Normalize-Path {
    param([string]$path)
    
    # Normalizar dobles barras invertidas a simples
    $path = $path -replace "\\\\", "\"
    
    # Mapear rutas de red \server\ a E:\
    if ($path -like "\server\*") {
        $path = $path -replace "^\\server\\", "E:\"
    }
    
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

function Handle-FileUpload {
    param(
        [System.Net.HttpListenerRequest]$request,
        [System.Net.HttpListenerResponse]$response
    )
    
    try {
        # Leer el cuerpo de la solicitud
        $boundary = $null
        $contentType = $request.ContentType
        if ($contentType -match 'boundary=(.+)$') {
            $boundary = "--" + $matches[1]
        } else {
            Send-JsonResponse -response $response -data @{
                success = $false
                error = "Content-Type debe ser multipart/form-data"
            } -statusCode 400
            return
        }
        
        # Leer el stream completo
        $reader = New-Object System.IO.StreamReader($request.InputStream)
        $content = $reader.ReadToEnd()
        $reader.Close()
        
        # Parsear multipart/form-data
        $parts = $content -split $boundary
        $fileName = $null
        $fileContent = $null
        
        foreach ($part in $parts) {
            if ($part -match 'Content-Disposition: form-data; name="file"; filename="([^"]+)"') {
                $fileName = $matches[1]
                # Extraer el contenido del archivo (después de los headers)
                $headerEnd = $part.IndexOf("`r`n`r`n")
                if ($headerEnd -gt 0) {
                    $fileContent = $part.Substring($headerEnd + 4)
                    # Remover el trailing boundary
                    $fileContent = $fileContent -replace "`r`n--$", ""
                }
            }
        }
        
        if ([string]::IsNullOrEmpty($fileName) -or $null -eq $fileContent) {
            Send-JsonResponse -response $response -data @{
                success = $false
                error = "No se encontró archivo en la solicitud"
            } -statusCode 400
            return
        }
        
        # Crear estructura de carpetas: E:\adjuntos\año\mes\
        $year = (Get-Date).Year
        $month = (Get-Date).ToString("MM")
        $uploadDir = "E:\adjuntos\$year\$month"
        
        if (-not (Test-Path $uploadDir)) {
            New-Item -ItemType Directory -Path $uploadDir -Force | Out-Null
            Write-Host "📁 Creado directorio: $uploadDir" -ForegroundColor Yellow
        }
        
        # Generar nombre único para el archivo
        $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
        $random = Get-Random -Minimum 1000 -Maximum 9999
        $extension = [System.IO.Path]::GetExtension($fileName)
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
        $uniqueFileName = "${baseName}_${timestamp}_${random}${extension}"
        $filePath = Join-Path $uploadDir $uniqueFileName
        
        # Guardar archivo
        [System.IO.File]::WriteAllBytes($filePath, [System.Text.Encoding]::Default.GetBytes($fileContent))
        
        $fileInfo = Get-Item $filePath
        
        Write-Host "✅ Archivo guardado: $filePath ($($fileInfo.Length) bytes)" -ForegroundColor Green
        
        # Responder con la información del archivo
        Send-JsonResponse -response $response -data @{
            success = $true
            fileName = $uniqueFileName
            originalName = $fileName
            filePath = $filePath
            size = $fileInfo.Length
            uploadDir = $uploadDir
        }
        
    } catch {
        Write-Host "❌ Error al subir archivo: $_" -ForegroundColor Red
        Send-JsonResponse -response $response -data @{
            success = $false
            error = "Error al procesar archivo"
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
        if ($url -eq "/file" -and $request.HttpMethod -eq "GET") {
            # Obtener la query string raw y decodificarla correctamente con UTF-8
            $rawUrl = $request.RawUrl
            if ($rawUrl -match "path=(.+)") {
                $encodedPath = $matches[1]
                # Decodificar con UTF-8 explícito
                $filePath = [System.Web.HttpUtility]::UrlDecode($encodedPath, [System.Text.Encoding]::UTF8)
            } else {
                $filePath = $null
            }
            
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
        
        # Endpoint: POST /upload
        if ($url -eq "/upload" -and $request.HttpMethod -eq "POST") {
            Handle-FileUpload -request $request -response $response
            continue
        }
        
        # Endpoint no encontrado
        Send-JsonResponse -response $response -data @{
            success = $false
            error = "Endpoint no encontrado"
            path = $url
            method = $request.HttpMethod
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
