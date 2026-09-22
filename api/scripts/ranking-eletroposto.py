#!/usr/bin/env python3
"""Refaz o dado da tela /gerador/estados a partir de DOIS meses do SENATRAN.

    python3 api/scripts/ranking-eletroposto.py junho julho 2026

Baixa as duas planilhas de "frota por UF, município e combustível" do gov.br
(guarda em cache na pasta temporária), lê as duas com a mesma régua do
gerar-frota-plugin.mjs, calcula o ranking de estados e de cidades, a seta de
movimento entre os dois meses, e grava o JSON dentro do próprio HTML da tela.

Rode quando o SENATRAN publicar planilha nova: é o único passo para a tela
mudar. A base é mensal, então não adianta rodar todo dia.

Depois de rodar, confira a tela e faça o commit do HTML alterado.
"""
import json, math, os, re, sys, tempfile, unicodedata, urllib.request, zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
MUNICIPIOS = os.path.join(RAIZ, 'api', 'src', 'data', 'municipios.json')
MJS = os.path.join(AQUI, 'gerar-frota-plugin.mjs')
TELA = os.path.join(RAIZ, 'dashboard', 'public', 'gerador', 'estados', 'index.html')
CACHE = os.path.join(tempfile.gettempdir(), 'senatran')

BASE_URL = ('https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/'
            'frota-de-veiculos-{ano}-2/D_Frota_por_UF_Municipio_COMBUSTIVEL_{mes}_{ano}.xlsx')
# julho/2026 subiu com outro nome; o gov.br não é regular nisso.
EXCECOES = {'julho_2026': 'copy_of_D_Frota_por_UF_Municipio_COMBUSTIVEL_Julho_2026.xlsx'}

PLUGIN = {'ELETRICO', 'ELETRICO/FONTE EXTERNA', 'ELETRICO/FONTE INTERNA', 'HIBRIDO PLUG-IN'}
PISO = 100   # plug-in emplacados para a cidade entrar na régua

UF = {
    'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM', 'BAHIA': 'BA', 'CEARA': 'CE',
    'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', 'GOIAS': 'GO', 'MARANHAO': 'MA',
    'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', 'MINAS GERAIS': 'MG', 'PARA': 'PA',
    'PARAIBA': 'PB', 'PARANA': 'PR', 'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'RIO DE JANEIRO': 'RJ',
    'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO', 'RORAIMA': 'RR',
    'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SERGIPE': 'SE', 'TOCANTINS': 'TO',
}
NOME_UF = {
    'AC': 'Acre', 'AL': 'Alagoas', 'AP': 'Amapá', 'AM': 'Amazonas', 'BA': 'Bahia', 'CE': 'Ceará',
    'DF': 'Distrito Federal', 'ES': 'Espírito Santo', 'GO': 'Goiás', 'MA': 'Maranhão',
    'MT': 'Mato Grosso', 'MS': 'Mato Grosso do Sul', 'MG': 'Minas Gerais', 'PA': 'Pará',
    'PB': 'Paraíba', 'PR': 'Paraná', 'PE': 'Pernambuco', 'PI': 'Piauí', 'RJ': 'Rio de Janeiro',
    'RN': 'Rio Grande do Norte', 'RS': 'Rio Grande do Sul', 'RO': 'Rondônia', 'RR': 'Roraima',
    'SC': 'Santa Catarina', 'SP': 'São Paulo', 'SE': 'Sergipe', 'TO': 'Tocantins',
}
NAVEGADOR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
    'Referer': 'https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/',
}


def norma(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^A-Z0-9]+', ' ', s.upper()).strip()


def apelidos():
    """Nome que o RENAVAM escreve diferente do IBGE. Mora no .mjs: leia de lá."""
    try:
        txt = open(MJS, encoding='utf-8').read()
    except OSError:
        return {}
    bloco = re.search(r'const APELIDOS = \{(.*?)\n\};', txt, re.S)
    return dict(re.findall(r"'([^']+)':\s*'([^']+)'", bloco.group(1))) if bloco else {}


def baixar(mes, ano):
    os.makedirs(CACHE, exist_ok=True)
    destino = os.path.join(CACHE, f'{mes.lower()}_{ano}.xlsx')
    if os.path.exists(destino) and os.path.getsize(destino) > 100000:
        return destino
    chave = f'{mes.lower()}_{ano}'
    if chave in EXCECOES:
        url = BASE_URL.rsplit('/', 1)[0].format(ano=ano) + '/' + EXCECOES[chave]
    else:
        url = BASE_URL.format(mes=mes.capitalize(), ano=ano)
    print(f'baixando {mes}/{ano}...', flush=True)
    req = urllib.request.Request(url, headers=NAVEGADOR)
    with urllib.request.urlopen(req, timeout=180) as r, open(destino, 'wb') as f:
        f.write(r.read())
    return destino


def linhas_da_planilha(arquivo):
    z = zipfile.ZipFile(arquivo)
    shared = z.read('xl/sharedStrings.xml').decode('utf-8', errors='replace')
    strs = []
    for si in re.findall(r'<si>(.*?)</si>', shared, re.S):
        t = re.sub(r'<[^>]+>', '', si)
        strs.append(t.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
                     .replace('&quot;', '"').replace('&apos;', "'"))
    sheet = z.read('xl/worksheets/sheet1.xml').decode('utf-8', errors='replace')
    for r in re.findall(r'<row[^>]*>(.*?)</row>', sheet, re.S):
        cel = []
        for attr, corpo in re.findall(r'<c r="[A-Z]+\d+"([^>]*?)(?:/>|>(.*?)</c>)', r, re.S):
            corpo = corpo or ''
            v = re.search(r'<v>([^<]*)</v>', corpo)
            v = v.group(1) if v else ''
            if 't="s"' in attr:
                cel.append(strs[int(v)] if v != '' else '')
            elif 't="inlineStr"' in attr:
                cel.append(re.sub(r'<[^>]+>', '', corpo))
            else:
                cel.append(v)
        yield cel


def frota_do_mes(arquivo, municipios, apel):
    chave = {f"{m['uf']}|{norma(m['n'])}": str(m['ibge']) for m in municipios}
    plugin_norm = {norma(p).replace(' ', '/') for p in PLUGIN}
    out, achou_cabecalho = {}, False
    for l in linhas_da_planilha(arquivo):
        if not achou_cabecalho:
            achou_cabecalho = any('Qtd. Ve' in str(c) for c in l)
            continue
        if len(l) < 4:
            continue
        uf = UF.get(norma(l[0]))
        if not uf:
            continue
        nome = norma(l[1])
        nome = apel.get(f'{uf}|{nome}', nome)
        ibge = chave.get(f'{uf}|{nome}')
        if not ibge:
            continue
        try:
            qtd = int(float(l[3] or 0))
        except ValueError:
            continue
        linha = out.setdefault(ibge, [0, 0])
        linha[0] += qtd
        if norma(l[2]).replace(' ', '/') in plugin_norm:
            linha[1] += qtd
    return out


def km(a, b):
    la, lb = math.radians(a['lat']), math.radians(b['lat'])
    dlo = math.radians(b['lng'] - a['lng'])
    h = math.sin((lb - la) / 2) ** 2 + math.cos(la) * math.cos(lb) * math.sin(dlo / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1.0, h)))


def calcular(base, idx):
    """Nota de carência por cidade: demanda vezes distância até o polo."""
    tf = sum(v[0] for v in base.values())
    tp = sum(v[1] for v in base.values())
    taxa = tp / tf
    L = []
    for k, (f, p) in base.items():
        m = idx.get(k)
        if m:
            L.append({'ibge': k, 'n': m['n'], 'uf': m['uf'], 'lat': m['lat'], 'lng': m['lng'], 'f': f, 'p': p})
    hubs = sorted(L, key=lambda r: -r['p'])[:60]
    for r in L:
        d = min(km(r, h) for h in hubs)
        ado = min(10, 5 * ((r['p'] / r['f']) / taxa)) if r['f'] else 0
        tam = min(10, 2.5 * math.log10(max(r['p'], 1)))
        r['d'] = d
        r['nota'] = (0.6 * tam + 0.4 * ado) * (0.15 + 0.085 * min(10, d / 25))
    return {r['ibge']: r for r in L}, taxa


def por_estado(cidades, taxa):
    E = {}
    for r in cidades.values():
        e = E.setdefault(r['uf'], {'plug': 0, 'frota': 0, 'fora': 0, 'cid': []})
        e['plug'] += r['p']
        e['frota'] += r['f']
        if r['d'] >= 80:
            e['fora'] += r['p']
        if r['p'] >= PISO:
            e['cid'].append(r)
    mx = math.log10(max(x['plug'] for x in E.values()))
    for e in E.values():
        tam = 10 * math.log10(max(e['plug'], 1)) / mx
        ado = min(10, 5 * ((e['plug'] / e['frota']) / taxa))
        inte = 10 * e['fora'] / max(e['plug'], 1)
        e['nota'] = 0.60 * tam + 0.20 * ado + 0.20 * inte
        e['por_mil'] = 1000 * e['plug'] / max(e['frota'], 1)
        e['longe'] = 100 * e['fora'] / max(e['plug'], 1)
    return E


def main():
    if len(sys.argv) < 4:
        print('uso: python3 api/scripts/ranking-eletroposto.py <mes anterior> <mes novo> <ano>')
        print('ex.:  python3 api/scripts/ranking-eletroposto.py junho julho 2026')
        return 1
    mes_ant, mes_novo, ano = sys.argv[1], sys.argv[2], sys.argv[3]

    municipios = json.load(open(MUNICIPIOS, encoding='utf-8'))
    idx = {str(m['ibge']): m for m in municipios}
    apel = apelidos()

    base_novo = frota_do_mes(baixar(mes_novo, ano), municipios, apel)
    base_ant = frota_do_mes(baixar(mes_ant, ano), municipios, apel)
    print(f'{mes_novo}: {len(base_novo)} municípios, {sum(v[1] for v in base_novo.values())} plug-in')
    print(f'{mes_ant}: {len(base_ant)} municípios, {sum(v[1] for v in base_ant.values())} plug-in')

    J, taxaJ = calcular(base_novo, idx)
    N, _ = calcular(base_ant, idx)
    eJ = {k: v for k, v in J.items() if v['p'] >= PISO}
    eN = {k: v for k, v in N.items() if v['p'] >= PISO}

    # A seta só compara quem estava na régua nos DOIS meses: cidade nova entrando
    # empurra todo mundo para baixo e faria a tela dizer que quase todas pioraram.
    comuns = set(eJ) & set(eN)
    posJ = {k: i + 1 for i, k in enumerate(sorted(comuns, key=lambda k: -eJ[k]['nota']))}
    posN = {k: i + 1 for i, k in enumerate(sorted(comuns, key=lambda k: -eN[k]['nota']))}
    ordem = sorted(eJ, key=lambda k: -eJ[k]['nota'])
    pos_nac = {k: i + 1 for i, k in enumerate(ordem)}

    def cidade(k):
        r = eJ[k]
        ant = base_ant.get(k, [0, 0])[1]
        # Ritmo: o quanto a frota cresceu no mes, em %. E a unica coisa aqui que
        # olha pra frente. Base menor que 30 carros nao gera ritmo: 2 carros num
        # vilarejo viram 100% e enganam a lista inteira.
        ritmo = round((r['p'] - ant) / ant * 100, 1) if ant >= 30 else None
        return [r['n'], r['uf'], round(r['lat'], 4), round(r['lng'], 4), r['p'],
                round(1000 * r['p'] / max(r['f'], 1), 1), round(r['d']), round(r['nota'], 2),
                pos_nac[k], (posN[k] - posJ[k]) if k in comuns else None,
                r['p'] - ant, ritmo]

    EJ, EN = por_estado(J, taxaJ), por_estado(N, taxaJ)
    ordem_est = sorted(EJ, key=lambda u: -EJ[u]['nota'])
    pos_est = {u: i + 1 for i, u in enumerate(ordem_est)}
    pos_est_ant = {u: i + 1 for i, u in enumerate(sorted(EN, key=lambda u: -EN[u]['nota']))}

    estados = []
    for uf in ordem_est:
        e = EJ[uf]
        cids = sorted([r['ibge'] for r in e['cid']], key=lambda k: pos_nac[k])
        estados.append({
            'uf': uf, 'nome': NOME_UF[uf], 'nota': round(e['nota'], 2),
            'mov': pos_est_ant.get(uf, pos_est[uf]) - pos_est[uf],
            'plug': e['plug'], 'novos': e['plug'] - (EN[uf]['plug'] if uf in EN else 0),
            'ritmo': round((e['plug'] - EN[uf]['plug']) / EN[uf]['plug'] * 100, 1) if uf in EN and EN[uf]['plug'] else None,
            'por_mil': round(e['por_mil'], 1), 'longe': round(e['longe'], 1),
            'acima': len(e['cid']), 'c': [cidade(k) for k in cids[:40]],
        })

    pack = {
        'ref': f'{mes_novo.lower()}/{ano}', 'ref_ant': f'{mes_ant.lower()}/{ano}', 'piso': PISO,
        'taxa_br': round(1000 * taxaJ, 1),
        'brasil': {
            'plug': sum(v[1] for v in base_novo.values()),
            'plug_ant': sum(v[1] for v in base_ant.values()),
            'na_regua': len(eJ), 'na_regua_ant': len(eN),
            'novos_na_regua': len(set(eJ) - set(eN)),
        },
        'nomes_uf': NOME_UF,
        'top50': [cidade(k) for k in ordem[:50]],
        # A segunda lente: para onde a curva esta indo, nao onde o estoque esta hoje.
        # Ordenada pelo ritmo do mes, com piso de 100 carros de base para o % significar algo.
        'top50_ritmo': [cidade(k) for k in sorted(
            [k for k in eJ if base_ant.get(k, [0, 0])[1] >= 100],
            key=lambda k: -((eJ[k]['p'] - base_ant[k][1]) / base_ant[k][1]))[:50]],
        'estados': estados,
    }

    html = open(TELA, encoding='utf-8').read()
    novo = json.dumps(pack, ensure_ascii=False, separators=(',', ':'))
    assert '</script' not in novo
    html2, n = re.subn(r'(<script id="dados" type="application/json">).*?(</script>)',
                       lambda m: m.group(1) + novo + m.group(2), html, count=1, flags=re.S)
    if n != 1:
        print('não achei o bloco de dados na tela, nada gravado')
        return 1
    open(TELA, 'w', encoding='utf-8').write(html2)
    print(f'tela atualizada: {len(eJ)} cidades na régua, {pack["brasil"]["novos_na_regua"]} novas, '
          f'{pack["brasil"]["plug"] - pack["brasil"]["plug_ant"]} carros a mais no mês')
    return 0


if __name__ == '__main__':
    sys.exit(main())
