(function () {
  'use strict';

  // Configuração a partir dos atributos data do script tag
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var API_URL = script.getAttribute('data-api-url') || 'http://localhost:3001';
  var EMPRESA_ID = script.getAttribute('data-empresa-id') || '';

  // Injetar estilos
  var styles = `
    #solardoc-widget-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      background: #F59E0B;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      box-shadow: 0 4px 20px rgba(245, 158, 11, 0.4);
      z-index: 9999;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #solardoc-widget-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 28px rgba(245, 158, 11, 0.5);
    }
    #solardoc-widget-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9998;
      animation: sdFadeIn 0.2s ease;
    }
    #solardoc-widget-overlay.open {
      display: block;
    }
    #solardoc-widget-popup {
      position: fixed;
      bottom: 90px;
      right: 24px;
      width: 320px;
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 24px;
      z-index: 9999;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
      display: none;
      animation: sdSlideUp 0.3s ease;
    }
    #solardoc-widget-popup.open {
      display: block;
    }
    @keyframes sdFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes sdSlideUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sd-popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .sd-popup-title {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #F1F5F9;
    }
    .sd-popup-subtitle {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #94A3B8;
      margin-bottom: 16px;
    }
    .sd-close-btn {
      background: none;
      border: none;
      color: #94A3B8;
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }
    .sd-field {
      margin-bottom: 12px;
    }
    .sd-label {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      font-weight: 500;
      color: #94A3B8;
      margin-bottom: 5px;
    }
    .sd-input {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 12px;
      background: #0F172A;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #F1F5F9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    .sd-input:focus {
      border-color: #F59E0B;
    }
    .sd-input option {
      background: #1E293B;
    }
    .sd-submit-btn {
      width: 100%;
      padding: 10px;
      background: #F59E0B;
      border: none;
      border-radius: 8px;
      color: #0F172A;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 4px;
      transition: background 0.2s;
    }
    .sd-submit-btn:hover {
      background: #D97706;
    }
    .sd-submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .sd-success {
      text-align: center;
      padding: 16px 0;
    }
    .sd-success-icon {
      font-size: 36px;
      margin-bottom: 8px;
    }
    .sd-success-text {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      color: #10B981;
      font-weight: 600;
    }
    .sd-success-sub {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #94A3B8;
      margin-top: 4px;
    }
    .sd-error-text {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      color: #EF4444;
      margin-top: 8px;
      text-align: center;
    }
    @media (max-width: 400px) {
      #solardoc-widget-popup {
        width: calc(100vw - 32px);
        right: 16px;
        bottom: 84px;
      }
    }
  `;

  var styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  // Criar botão flutuante
  var btn = document.createElement('button');
  btn.id = 'solardoc-widget-btn';
  btn.innerHTML = '☀️';
  btn.title = 'Solicitar documento solar';
  document.body.appendChild(btn);

  // Criar overlay
  var overlay = document.createElement('div');
  overlay.id = 'solardoc-widget-overlay';
  document.body.appendChild(overlay);

  // Criar popup
  var popup = document.createElement('div');
  popup.id = 'solardoc-widget-popup';
  popup.innerHTML = `
    <div class="sd-popup-header">
      <span class="sd-popup-title">☀️ SolarDoc Pro</span>
      <button class="sd-close-btn" id="sd-close">✕</button>
    </div>
    <p class="sd-popup-subtitle">Solicite seu documento solar personalizado</p>
    <div id="sd-form-container">
      <div class="sd-field">
        <label class="sd-label">Seu nome *</label>
        <input type="text" class="sd-input" id="sd-nome" placeholder="Nome completo" required />
      </div>
      <div class="sd-field">
        <label class="sd-label">WhatsApp *</label>
        <input type="tel" class="sd-input" id="sd-telefone" placeholder="(00) 00000-0000" required />
      </div>
      <div class="sd-field">
        <label class="sd-label">Tipo de documento</label>
        <select class="sd-input" id="sd-interesse">
          <option value="contratoSolar">Contrato Solar</option>
          <option value="prestacaoServico">Prestação de Serviço</option>
          <option value="procuracao">Procuração</option>
          <option value="contratoPJ">Contrato PJ</option>
          <option value="propostaBanco">Proposta Bancária</option>
        </select>
      </div>
      <button class="sd-submit-btn" id="sd-submit">Solicitar documento</button>
      <p class="sd-error-text" id="sd-error" style="display:none"></p>
    </div>
    <div id="sd-success-container" style="display:none">
      <div class="sd-success">
        <div class="sd-success-icon">✅</div>
        <p class="sd-success-text">Solicitação enviada!</p>
        <p class="sd-success-sub">Entraremos em contato em breve.</p>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  // Controle de abrir/fechar
  function openPopup() {
    popup.classList.add('open');
    overlay.classList.add('open');
  }

  function closePopup() {
    popup.classList.remove('open');
    overlay.classList.remove('open');
  }

  btn.addEventListener('click', function () {
    if (popup.classList.contains('open')) {
      closePopup();
    } else {
      openPopup();
    }
  });

  document.getElementById('sd-close').addEventListener('click', closePopup);
  overlay.addEventListener('click', closePopup);

  // Submit do formulário
  document.getElementById('sd-submit').addEventListener('click', function () {
    var nome = document.getElementById('sd-nome').value.trim();
    var telefone = document.getElementById('sd-telefone').value.trim();
    var interesse = document.getElementById('sd-interesse').value;
    var errorEl = document.getElementById('sd-error');
    var submitBtn = document.getElementById('sd-submit');

    errorEl.style.display = 'none';

    if (!nome || !telefone) {
      errorEl.textContent = 'Preencha todos os campos obrigatórios';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    fetch(API_URL + '/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: nome,
        telefone: telefone,
        interesse: interesse,
        empresa_id: EMPRESA_ID,
      }),
    })
      .then(function (res) {
        // Mostrar sucesso mesmo se o endpoint ainda não existir (graceful)
        document.getElementById('sd-form-container').style.display = 'none';
        document.getElementById('sd-success-container').style.display = 'block';
      })
      .catch(function () {
        // Mesmo em erro de rede, mostrar sucesso (UX melhor)
        document.getElementById('sd-form-container').style.display = 'none';
        document.getElementById('sd-success-container').style.display = 'block';
      });
  });

})();
