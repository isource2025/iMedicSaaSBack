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
            $boundary = $matches[1]
        } else {
            Send-JsonResponse -response $response -data @{
                success = $false
                error = "Content-Type debe ser multipart/form-data"
            } -statusCode 400
            return
        }
        
        # Leer el stream completo como BYTES (no como texto)
        $memoryStream = New-Object System.IO.MemoryStream
        $request.InputStream.CopyTo($memoryStream)
        $bodyBytes = $memoryStream.ToArray()
        $memoryStream.Close()
        
        # Convertir boundary a bytes
        $boundaryBytes = [System.Text.Encoding]::UTF8.GetBytes("--$boundary")
        $crlfBytes = [System.Text.Encoding]::UTF8.GetBytes("`r`n")
        
        # Variables para almacenar los datos parseados
        $fileName = $null
        $fileBytes = $null
        $numeroVisita = $null
        $nombrePaciente = $null
        
        # Parsear multipart/form-data manualmente
        $position = 0
        while ($position -lt $bodyBytes.Length) {
            # Buscar el siguiente boundary
            $boundaryIndex = -1
            for ($i = $position; $i -lt ($bodyBytes.Length - $boundaryBytes.Length); $i++) {
                $match = $true
                for ($j = 0; $j -lt $boundaryBytes.Length; $j++) {
                    if ($bodyBytes[$i + $j] -ne $boundaryBytes[$j]) {
                        $match = $false
                        break
                    }
                }
                if ($match) {
                    $boundaryIndex = $i
                    break
                }
            }
            
            if ($boundaryIndex -eq -1) { break }
            
            # Saltar el boundary y CRLF
            $position = $boundaryIndex + $boundaryBytes.Length + 2
            
            # Leer headers hasta encontrar CRLF CRLF
            $headerEnd = -1
            for ($i = $position; $i -lt ($bodyBytes.Length - 3); $i++) {
                if ($bodyBytes[$i] -eq 13 -and $bodyBytes[$i+1] -eq 10 -and 
                    $bodyBytes[$i+2] -eq 13 -and $bodyBytes[$i+3] -eq 10) {
                    $headerEnd = $i
                    break
                }
            }
            
            if ($headerEnd -eq -1) { break }
            
            # Extraer headers
            $headerLength = $headerEnd - $position
            $headerBytes = $bodyBytes[$position..($headerEnd - 1)]
            $headers = [System.Text.Encoding]::UTF8.GetString($headerBytes)
            
            # Posición del contenido (después de CRLF CRLF)
            $contentStart = $headerEnd + 4
            
            # Buscar el siguiente boundary para saber dónde termina el contenido
            $nextBoundaryIndex = -1
            for ($i = $contentStart; $i -lt ($bodyBytes.Length - $boundaryBytes.Length); $i++) {
                $match = $true
                for ($j = 0; $j -lt $boundaryBytes.Length; $j++) {
                    if ($bodyBytes[$i + $j] -ne $boundaryBytes[$j]) {
                        $match = $false
                        break
                    }
                }
                if ($match) {
                    $nextBoundaryIndex = $i
                    break
                }
            }
            
            if ($nextBoundaryIndex -eq -1) { break }
            
            # Extraer contenido (sin el CRLF antes del boundary)
            $contentEnd = $nextBoundaryIndex - 2
            $contentLength = $contentEnd - $contentStart
            
            # Parsear según el tipo de campo
            if ($headers -match 'name="file".*filename="([^"]+)"') {
                $fileName = $matches[1]
                $fileBytes = $bodyBytes[$contentStart..($contentEnd - 1)]
                Write-Host "📄 Archivo encontrado: $fileName ($($fileBytes.Length) bytes)" -ForegroundColor Cyan
            }
            elseif ($headers -match 'name="numeroVisita"') {
                $fieldBytes = $bodyBytes[$contentStart..($contentEnd - 1)]
                $numeroVisita = [System.Text.Encoding]::UTF8.GetString($fieldBytes).Trim()
                Write-Host "📋 NumeroVisita recibido: '$numeroVisita'" -ForegroundColor Magenta
            }
            elseif ($headers -match 'name="nombrePaciente"') {
                $fieldBytes = $bodyBytes[$contentStart..($contentEnd - 1)]
                $nombrePaciente = [System.Text.Encoding]::UTF8.GetString($fieldBytes).Trim()
                Write-Host "👤 NombrePaciente recibido: '$nombrePaciente'" -ForegroundColor Magenta
            }
            
            # Mover posición al siguiente boundary
            $position = $nextBoundaryIndex
        }
        
        if ([string]::IsNullOrEmpty($fileName) -or $null -eq $fileBytes) {
            Send-JsonResponse -response $response -data @{
                success = $false
                error = "No se encontró archivo en la solicitud"
            } -statusCode 400
            return
        }
        
        # Log de debug de valores parseados
        Write-Host "`n=== VALORES PARSEADOS ===" -ForegroundColor Yellow
        Write-Host "Archivo: $fileName ($($fileBytes.Length) bytes)" -ForegroundColor White
        Write-Host "NumeroVisita: '$numeroVisita' (IsNullOrEmpty: $([string]::IsNullOrEmpty($numeroVisita)))" -ForegroundColor White
        Write-Host "NombrePaciente: '$nombrePaciente' (IsNullOrEmpty: $([string]::IsNullOrEmpty($nombrePaciente)))" -ForegroundColor White
        Write-Host "========================`n" -ForegroundColor Yellow
        
        # Crear estructura de carpetas: E:\Imagenes\Vidal\{NumeroVisita} {NombrePaciente}\
        $baseDir = "E:\Imagenes\Vidal"
        
        # Construir nombre de carpeta del paciente
        if ([string]::IsNullOrEmpty($numeroVisita) -or [string]::IsNullOrEmpty($nombrePaciente)) {
            # Si no hay datos del paciente, usar estructura por fecha
            $year = (Get-Date).Year
            $month = (Get-Date).ToString("MM")
            $uploadDir = "E:\adjuntos\$year\$month"
        } else {
            # Limpiar nombre del paciente (quitar caracteres no válidos para carpetas)
            $nombrePacienteLimpio = $nombrePaciente -replace '[<>:"/\\|?*]', '_'
            $carpetaPaciente = "$numeroVisita $nombrePacienteLimpio"
            $uploadDir = Join-Path $baseDir $carpetaPaciente
        }
        
        if (-not (Test-Path $uploadDir)) {
            New-Item -ItemType Directory -Path $uploadDir -Force | Out-Null
            Write-Host "📁 Creado directorio: $uploadDir" -ForegroundColor Yellow
        }
        
        # Usar el nombre original del archivo (sin timestamp ni random)
        $filePath = Join-Path $uploadDir $fileName
        
        # Guardar archivo directamente como bytes (sin conversión de encoding)
        [System.IO.File]::WriteAllBytes($filePath, $fileBytes)
        
        $fileInfo = Get-Item $filePath
        
        Write-Host "✅ Archivo guardado: $filePath ($($fileInfo.Length) bytes)" -ForegroundColor Green
        
        # Convertir E:\ a \\server\ para el path que se guarda en la BD
        $filePathServidor = $filePath -replace "^E:\\", "\\server\"
        
        Write-Host "📋 Path para BD: $filePathServidor" -ForegroundColor Cyan
        
        # Responder con la información del archivo
        Send-JsonResponse -response $response -data @{
            success = $true
            fileName = $fileName
            originalName = $fileName
            filePath = $filePathServidor
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
