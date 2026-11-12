# RuneTimer

Mini app de navegador pra **craft de runas no Tibia classic (7.1)**.

Controla o tempo de regeneração de mana com um frasco que enche, avisa com sino quando fica pronto, e ainda acompanha a **fome** (Meat / Ham) pra não dessincronizar do jogo.

---

## Funciona assim

| Feature | O que faz |
|---|---|
| Frasco de mana | Enche conforme a regen da vocação |
| Druid / Elder | 1 mana / 6s ou 1 mana / 4s |
| Fome | Drena com o tempo; Meat (+3 min) e Ham (+6 min) |
| Sem fome = sem regen | Igual no Tibia: mana para até você comer |
| Sino | Alerta quando a mana enche |
| Ronco | Alerta quando a fome zera |
| Sync | Ajusta pela mana atual do client |
| Miniwindow | Janelinha por cima (Picture-in-Picture) |
| Persistência | Lembra configs, mana e fome no refresh |

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
- **Druid:** 1 mana / 6s  
- **Elder Druid:** 1 mana / 4s  

Tudo isso é ajustável na tela de configuração.

---

## Estrutura

```
runetimer/
├── index.html
├── abrir.bat
├── css/style.css
├── js/app.js
├── assets/          # ícones Meat / Ham
└── sounds/          # sino + alerta de fome
```

Sem build, sem dependências — só HTML/CSS/JS.

---

## Licença

Uso pessoal. Os sprites de Meat/Ham são assets do Tibia (CipSoft). Os efeitos sonoros pertencem aos respectivos autores dos arquivos inclusos.
