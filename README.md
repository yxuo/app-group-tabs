# App Group Tabs

Uma extensão GNOME Shell que permite agrupar janelas de aplicativos usando um sistema de abas.

## Funcionalidades

- **Barra de abas automática**: Cada janela automaticamente recebe uma barra de abas
- **Agrupamento por arrastar e soltar**: Arraste uma janela sobre outra para criar um grupo
- **Indicação visual**: Feedback visual mostra quando uma janela pode ser solta para criar um grupo
- **Navegação entre abas**: Clique nas abas para alternar entre as janelas do grupo
- **Dissolução de grupos**: Botão para dissolver grupos e retornar as janelas ao estado individual
- **Indicador na barra superior**: Ícone na barra superior com menu para gerenciar grupos

## Como usar

1. **Visualizar abas individuais**:
   - Cada janela automaticamente mostra uma barra de abas
   - Para janelas individuais, a barra mostra apenas uma aba

2. **Criar um grupo**:
   - Arraste uma janela sobre outra janela
   - Você verá um indicador visual azul ao redor da janela de destino
   - Solte a janela para criar o grupo

3. **Navegar entre abas**:
   - Clique em qualquer aba na barra para ativar essa janela
   - A aba ativa é destacada em azul

4. **Dissolver um grupo**:
   - Clique no botão "X" na extremidade direita da barra de abas
   - Todas as janelas retornarão ao estado individual com suas próprias barras

5. **Usar o indicador da barra superior**:
   - Clique no ícone de grade na barra superior para acessar o menu
   - "Grupos Ativos": Mostra quantos grupos e janelas estão ativos
   - "Requerer Alt para Agrupar": Liga/desliga o modo que exige Alt pressionado
   - "Dissolver Todos os Grupos": Remove todos os agrupamentos de uma vez

## Comportamento

- Todas as janelas automaticamente recebem uma barra de abas (modo de desenvolvimento simplificado)
- A barra de abas só aparece quando há pelo menos uma janela não minimizada no grupo
- A barra de abas segue a janela ativa não minimizada do grupo
- Quando uma janela é fechada, ela é automaticamente removida do grupo
- Grupos com apenas uma janela mostram uma barra com uma única aba (se não estiver minimizada)
- **Modo de agrupamento configurável**: Por padrão, arraste qualquer janela sobre outra para criar grupos. Ative "Requerer Alt para Agrupar" no menu para exigir Alt pressionado
- Janelas minimizadas fazem a barra de abas desaparecer até que alguma janela do grupo seja desmimizada

## Instalação

1. Copie a extensão para o diretório de extensões do GNOME:

   ```bash
   ~/.local/share/gnome-shell/extensions/app-group-tabs@yxuo.github.io/
   ```

2. Reinicie o GNOME Shell:
   - No X11: `Alt + F2`, digite `r` e pressione Enter
   - No Wayland: Faça logout e login novamente

3. Ative a extensão usando o GNOME Extensions ou via linha de comando:

   ```bash
   gnome-extensions enable app-group-tabs@yxuo.github.io
   ```

## Compatibilidade

- GNOME Shell 45+
- Testado no GNOME 46

## Desenvolvimento

Esta extensão foi desenvolvida usando as APIs padrão do GNOME Shell:

- `Meta` para gerenciamento de janelas
- `St` para elementos de interface
- `Clutter` para eventos e animações

## Licença

GPL-2.0-or-later
