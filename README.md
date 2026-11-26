# RuneTimer

Mini app de navegador pra **craft de runas no Tibia classic (7.1)**.

Controla o tempo de regeneração de mana com um frasco que enche, avisa com sino quando fica pronto, e ainda acompanha a **fome** (Meat / Ham) pra não dessincronizar do jogo.

---

## Funciona assim

| Feature | O que faz |
|---|---|
| Frasco de mana | Enche conforme a regen da vocação |
| Vocações | Mage, Promoted Mage, Paladin, Royal Paladin |
| Tutorial | Tour passo a passo com spotlight nos controles |
| Fome | Drena com o tempo; Meat (+3 min) e Ham (+6 min) |
| Sem fome = sem regen | Igual no Tibia: mana para até você comer |
| Sino | Alerta quando a mana enche |
| Ronco | Alerta quando a fome zera |
| Sync | Ajusta pela mana atual do client |
| Miniwindow | Janelinha por cima (Picture-in-Picture) |
| Persistência | Lembra configs, mana e fome no refresh |
| Online | Contador via Worker (segredo só no servidor) |

---

## Como abrir

### Local (Windows)

Duplo clique em `abrir.bat`  
ou abra o `index.html` no Chrome / Edge.

### GitHub Pages

Depois de publicar o repositório:

1. **Settings → Pages**
2. Source: branch `main` (ou `master`), pasta `/ (root)`
3. Acesse `https://SEU_USER.github.io/NOME_DO_REPO/`

> A miniwindow (PiP) funciona melhor no Pages (HTTPS) do que abrindo o arquivo local.

---

## Uso rápido

1. Configure **runas**, **mana por runa** e **vocação**
2. Clique **Ham** / **Meat** pra encher a fome
3. Clique **Craftar** (começa em 1 mana)
4. Quando encher → sino + “De novo”
5. Se dessincronizar → digite a **mana atual** e **Sincronizar**

Na miniwindow ficam os frascos, comidas, controles e o sync rápido de mana.

---

## Defaults classic

- **Meat:** 180s (3 min)  
- **Ham:** 360s (6 min)  
- **Fome máxima:** 1200s (20 min) ≈ 3 Ham  
- **Mage:** 1 mana / 6s  
- **Promoted Mage:** 1 mana / 4s  
- **Paladin:** 1 mana / 8s  
- **Royal Paladin:** 1 mana / 6s  

Tudo isso é ajustável na tela de configuração.

---

## Estrutura

```
runetimer/
├── index.html
├── abrir.bat
├── api/presence.js        # contador online (Vercel Function)
├── package.json           # deps da API
├── css/style.css
├── js/
│   ├── app.js
│   ├── config.js          # presenceUrl (publico, sem senha)
│   └── config.example.js
├── assets/                # ícones Meat / Ham
└── sounds/                # sino + alerta de fome
```

Frontend: HTML/CSS/JS. Hosting recomendado: **Vercel** (site + `/api/presence`).
Segredo do banco: **somente** em Environment Variable `DATABASE_URL` na Vercel.

### Contador online (Vercel)

1. No deploy da Vercel, cria `DATABASE_URL` com a connection string da role `presence_web`
2. `js/config.js` já aponta pra `/api/presence`
3. Pronto — o badge online aparece no mesmo domínio

Se `presenceUrl` estiver vazio, o badge fica oculto.

---

## Licença

Uso pessoal. Os sprites de Meat/Ham são assets do Tibia (CipSoft). Os efeitos sonoros pertencem aos respectivos autores dos arquivos inclusos.
