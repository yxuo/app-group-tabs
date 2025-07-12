#!/bin/bash

# Script de instalação para App Group Tabs
# Extensão GNOME Shell para agrupar janelas com abas

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para imprimir mensagens coloridas
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar se está rodando no GNOME
if [ "$XDG_CURRENT_DESKTOP" != "GNOME" ]; then
    print_warning "Este script foi projetado para o GNOME Shell"
    print_warning "Desktop atual: $XDG_CURRENT_DESKTOP"
    read -p "Deseja continuar mesmo assim? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Verificar versão do GNOME Shell
GNOME_VERSION=$(gnome-shell --version | grep -oP '\d+')
if [ "$GNOME_VERSION" -lt 45 ]; then
    print_error "Esta extensão requer GNOME Shell 45 ou superior"
    print_error "Versão atual: $(gnome-shell --version)"
    exit 1
fi

print_status "Versão do GNOME Shell: $(gnome-shell --version)"

# Diretório da extensão
EXTENSION_UUID="app-group-tabs@yxuo.github.io"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_status "Instalando App Group Tabs..."

# Criar diretório se não existir
mkdir -p "$HOME/.local/share/gnome-shell/extensions"

# Copiar arquivos da extensão
if [ "$CURRENT_DIR" != "$EXTENSION_DIR" ]; then
    print_status "Copiando arquivos para $EXTENSION_DIR"
    
    # Remover instalação anterior se existir
    if [ -d "$EXTENSION_DIR" ]; then
        print_status "Removendo instalação anterior..."
        rm -rf "$EXTENSION_DIR"
    fi
    
    # Criar novo diretório e copiar arquivos
    mkdir -p "$EXTENSION_DIR"
    cp "$CURRENT_DIR"/*.js "$EXTENSION_DIR/"
    cp "$CURRENT_DIR"/*.json "$EXTENSION_DIR/"
    cp "$CURRENT_DIR"/*.css "$EXTENSION_DIR/"
    
    if [ -f "$CURRENT_DIR/README.md" ]; then
        cp "$CURRENT_DIR/README.md" "$EXTENSION_DIR/"
    fi
else
    print_status "Extensão já está no diretório correto"
fi

print_success "Arquivos da extensão instalados!"

# Verificar se gnome-extensions está disponível
if command -v gnome-extensions >/dev/null 2>&1; then
    # Desabilitar se já estiver habilitada
    if gnome-extensions list --enabled | grep -q "$EXTENSION_UUID"; then
        print_status "Desabilitando extensão existente..."
        gnome-extensions disable "$EXTENSION_UUID"
        sleep 1
    fi
    
    # Habilitar a extensão
    print_status "Habilitando a extensão..."
    gnome-extensions enable "$EXTENSION_UUID"
    
    if gnome-extensions list --enabled | grep -q "$EXTENSION_UUID"; then
        print_success "Extensão habilitada com sucesso!"
    else
        print_error "Falha ao habilitar a extensão"
        exit 1
    fi
else
    print_warning "Comando gnome-extensions não encontrado"
    print_status "Você pode habilitar a extensão manualmente usando:"
    print_status "- GNOME Extensions app"
    print_status "- Ou via linha de comando: gnome-extensions enable $EXTENSION_UUID"
fi

# Verificar se precisa reiniciar o GNOME Shell
if [ "$XDG_SESSION_TYPE" = "x11" ]; then
    print_status "Para aplicar as mudanças no X11:"
    print_status "Pressione Alt+F2, digite 'r' e pressione Enter"
elif [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    print_status "Para aplicar as mudanças no Wayland:"
    print_status "Faça logout e login novamente"
fi

print_success "Instalação concluída!"
print_status ""
print_status "Como usar:"
print_status "1. Cada janela automaticamente tem uma barra de abas"
print_status "2. Arraste uma janela sobre outra para criar grupos"
print_status "3. Clique nas abas para alternar entre janelas"
print_status "4. Use o botão X para dissolver o grupo"
