@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" amd64
cd /d "D:\Nextbase\openclaw-desktop\node_modules\.pnpm\better-sqlite3@11.10.0\node_modules\better-sqlite3"
npx node-gyp rebuild --release
