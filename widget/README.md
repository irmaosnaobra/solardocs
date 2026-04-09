# SolarDoc Pro Widget

Widget embeddable para captura de leads diretamente no site da empresa.

## Como usar

Adicione o script ao final do `<body>` do seu site:

```html
<script
  src="https://cdn.solardoc.pro/widget.min.js"
  data-api-url="https://api.solardoc.pro"
  data-empresa-id="SEU_ID_AQUI"
></script>
```

## Desenvolvimento local

```html
<script
  src="http://localhost:8080/src/widget.js"
  data-api-url="http://localhost:3001"
  data-empresa-id="test-id"
></script>
```

## Build (minificação)

```bash
npm install
npm run build
```

O arquivo minificado será gerado em `dist/widget.min.js`.

## Como testar

Crie um arquivo `test.html`:
```html
<!DOCTYPE html>
<html>
<body>
  <h1>Teste do Widget SolarDoc Pro</h1>
  <script src="./src/widget.js" data-api-url="http://localhost:3001" data-empresa-id="test"></script>
</body>
</html>
```

Abra no browser com `npm run dev` e acesse `http://localhost:8080/test.html`.
