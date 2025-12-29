FROM e2bdev/code-interpreter:latest

WORKDIR /home/user

# Scaffold Vite app into a temp dir, then move it into place
RUN npx create-vite@latest tempapp --template react-ts --yes && \
    mv tempapp/* tempapp/.* . 2>/dev/null || true && \
    rmdir tempapp

# Install base deps first
RUN npm install

# Install Tailwind and related packages
RUN npm install -D tailwindcss postcss autoprefixer

# Manually create tailwind.config.js
RUN echo '/** @type {import("tailwindcss").Config} */' > tailwind.config.js && \
    echo 'export default {' >> tailwind.config.js && \
    echo '  content: [' >> tailwind.config.js && \
    echo '    "./index.html",' >> tailwind.config.js && \
    echo '    "./src/**/*.{js,ts,jsx,tsx}",' >> tailwind.config.js && \
    echo '  ],' >> tailwind.config.js && \
    echo '  theme: {' >> tailwind.config.js && \
    echo '    extend: {},' >> tailwind.config.js && \
    echo '  },' >> tailwind.config.js && \
    echo '  plugins: [],' >> tailwind.config.js && \
    echo '}' >> tailwind.config.js

# Manually create postcss.config.js
RUN echo 'export default {' > postcss.config.js && \
    echo '  plugins: {' >> postcss.config.js && \
    echo '    tailwindcss: {},' >> postcss.config.js && \
    echo '    autoprefixer: {},' >> postcss.config.js && \
    echo '  },' >> postcss.config.js && \
    echo '}' >> postcss.config.js

# Replace the default index.css with Tailwind directives
RUN printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > src/index.css

# Update vite.config.ts to allow all hosts
RUN printf 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    host: "0.0.0.0",\n    allowedHosts: true,\n  },\n});\n' > vite.config.ts