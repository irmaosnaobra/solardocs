import { describe, it, expect } from 'vitest';
import { lerCoordenadas } from '../routes/vistorias';

// ─────────────────────────────────────────────────────────────────────────────
// O que este arquivo trava: o que acontece quando o integrador COLA a localização
// que o cliente mandou no WhatsApp.
//
// O pedido veio do Gedalih (24/08/2026) e o caso dele manda no desenho: o cliente
// mandou o ponto, ele perdeu no celular, e a obra "é na roça". Ou seja, o que
// chega neste campo é imprevisível — link comprido do Maps, link curto, par de
// coordenadas solto, número com vírgula porque o teclado é BR.
//
// A REGRA DURA: nada do que a pessoa colar pode ser jogado fora em silêncio. O que
// dá pra ler vira coordenada; o que não dá continua guardado como link ou texto.
// Perder de novo a localização do cliente é exatamente o problema que ele relatou.
// ─────────────────────────────────────────────────────────────────────────────

describe('lerCoordenadas — o que o cliente manda', () => {
  it('par solto, do jeito que o WhatsApp copia', () => {
    expect(lerCoordenadas('-22.906847, -43.172896')).toEqual({ lat: -22.906847, lng: -43.172896 });
  });

  it('link do Maps com @ (o que sai do "compartilhar" no computador)', () => {
    expect(lerCoordenadas('https://www.google.com/maps/@-22.906847,-43.172896,17z'))
      .toEqual({ lat: -22.906847, lng: -43.172896 });
  });

  it('link do Maps com ?q= (o que sai do celular)', () => {
    expect(lerCoordenadas('https://maps.google.com/?q=-19.748611,-47.938889'))
      .toEqual({ lat: -19.748611, lng: -47.938889 });
  });

  it('vírgula decimal, porque o teclado é brasileiro', () => {
    expect(lerCoordenadas('-22,906847; -43,172896')).toEqual({ lat: -22.906847, lng: -43.172896 });
  });

  it('coordenada no meio de uma frase ainda é achada', () => {
    expect(lerCoordenadas('é aqui ó: -21.135500, -44.888100 (portão de trás)'))
      .toEqual({ lat: -21.1355, lng: -44.8881 });
  });

  // ── Os que NÃO viram coordenada, e por que isso está certo ──

  it('link curto do maps.app.goo.gl não tem coordenada — vira link, não é descartado', () => {
    // A rota guarda o link cru neste caso. Ele abre no celular de quem clicar,
    // que é tudo que o integrador precisa; resolver o encurtador exigiria bater
    // na rede do Google no meio de um POST.
    expect(lerCoordenadas('https://maps.app.goo.gl/aB3xY7pQ2')).toBeNull();
  });

  it('texto puro não vira coordenada — a rota guarda como apelido do ponto', () => {
    expect(lerCoordenadas('fundos do sítio, depois da porteira')).toBeNull();
  });

  it('número fora do planeta é recusado', () => {
    // 200 graus de latitude não existe. Sem esta trava, um preço colado por engano
    // ("1.234,56, 987,65") viraria um pino no meio do oceano.
    expect(lerCoordenadas('200.123456, 300.123456')).toBeNull();
  });

  it('inteiro sem casa decimal não conta como coordenada', () => {
    // "15, 30" é quantidade de módulo e inversor, não um ponto no mapa. Exigir
    // 4 casas decimais é o que separa uma coordenada de dois números quaisquer.
    expect(lerCoordenadas('15, 30')).toBeNull();
  });

  it('campo vazio não explode', () => {
    expect(lerCoordenadas('')).toBeNull();
  });
});
