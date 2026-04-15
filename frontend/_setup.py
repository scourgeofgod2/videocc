import os, json

base = r'c:/Program Files/clipmatic.video/webapp/frontend'
os.makedirs(base + '/src/api', exist_ok=True)
os.makedirs(base + '/src/components', exist_ok=True)

# tsconfig.app.json
with open(base+'/tsconfig.app.json','w') as f:
    json.dump({'compilerOptions':{'target':'ES2020','useDefineForClassFields':True,'lib':['ES2020','DOM','DOM.Iterable'],'module':'ESNext','skipLibCheck':True,'moduleResolution':'bundler','allowImportingTsExtensions':True,'isolatedModules':True,'moduleDetection':'force','noEmit':True,'jsx':'react-jsx','strict':True,'noUnusedLocals':True,'noUnusedParameters':True,'noFallthroughCasesInSwitch':True},'include':['src']},f,indent=2)

# tsconfig.node.json
with open(base+'/tsconfig.node.json','w') as f:
    json.dump({'compilerOptions':{'target':'ES2022','lib':['ES2023'],'module':'ESNext','skipLibCheck':True,'moduleResolution':'bundler','allowImportingTsExtensions':True,'isolatedModules':True,'moduleDetection':'force','noEmit':True,'strict':True},'include':['vite.config.ts']},f,indent=2)

# vite.config.ts
with open(base+'/vite.config.ts','w', encoding='utf-8') as f:
    f.write('import { defineConfig } from "vite"\n')
    f.write('import react from "@vitejs/plugin-react"\n')
    f.write('export default defineConfig({\n')
    f.write('  plugins: [react()],\n')
    f.write('  server: {\n')
    f.write('    proxy: {\n')
    f.write('      "/api": { target: "http://localhost:3001", changeOrigin: true },\n')
    f.write('      "/output": { target: "http://localhost:3001", changeOrigin: true },\n')
    f.write('    },\n')
    f.write('  },\n')
    f.write('})\n')

# tailwind.config.js
with open(base+'/tailwind.config.js','w', encoding='utf-8') as f:
    f.write('/** @type {import("tailwindcss").Config} */\n')
    f.write('export default {\n')
    f.write('  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],\n')
    f.write('  theme: { extend: {} },\n')
    f.write('  plugins: [],\n')
    f.write('}\n')

# postcss.config.js
with open(base+'/postcss.config.js','w', encoding='utf-8') as f:
    f.write('export default { plugins: { tailwindcss: {}, autoprefixer: {} } }\n')

# index.html
with open(base+'/index.html','w', encoding='utf-8') as f:
    f.write('<!doctype html>\n')
    f.write('<html lang="en">\n')
    f.write('<head>\n')
    f.write('<meta charset="UTF-8" />\n')
    f.write('<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n')
    f.write('<title>Clipmatic</title>\n')
    f.write('</head>\n')
    f.write('<body>\n')
    f.write('<div id="root"></div>\n')
    f.write('<script type="module" src="/src/main.tsx"></script>\n')
    f.write('</body>\n')
    f.write('</html>\n')

print('all config files created')