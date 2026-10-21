# Petit serveur local pour Pelicane (aucune installation : utilise PowerShell, deja present sous Windows).
# Necessaire pour lire les bandes-annonces YouTube dans l'appli (YouTube refuse les pages ouvertes depuis un fichier).
# Lancement : double-clic sur lancer.bat, puis ouvrir http://localhost:8080
$root = $PSScriptRoot
$port = 8080
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8"
  ".png" = "image/png"; ".jpg" = "image/jpeg"; ".svg" = "image/svg+xml"; ".json" = "application/json"; ".ico" = "image/x-icon"
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Pelicane tourne sur http://localhost:$port/  (fermer cette fenetre pour arreter)"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }
    $full = [IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart("/") -replace "/", "\")))
    if ($full.StartsWith($root) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" })
      $bytes = [IO.File]::ReadAllBytes($full)
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch { $ctx.Response.StatusCode = 500 }
  $ctx.Response.Close()
}
