# find out which distribution we are running on
MFILE="/System/Library/CoreServices/SystemVersion.plist"
if [[ -f /etc/os-release ]]; then
  _distro=$(awk -F'=' '/^ID=/{ print tolower($2) }' /etc/os-release | tr -d '"')
elif [[ -f $MFILE ]]; then
  _distro="macos"
fi

# set an icon based on the distro
# make sure your font is compatible with https://github.com/lukas-w/font-logos
case $_distro in
    *kali*)                  ICON="ﴣ";;
    *arch*)                  ICON="";;
    *debian*)                ICON="";;
    *raspbian*)              ICON="";;
    *ubuntu*)                ICON="";;
    *elementary*)            ICON="";;
    *fedora*)                ICON="";;
    *coreos*)                ICON="";;
    *gentoo*)                ICON="";;
    *mageia*)                ICON="";;
    *centos*)                ICON="";;
    *opensuse*|*tumbleweed*) ICON="";;
    *sabayon*)               ICON="";;
    *slackware*)             ICON="";;
    *linuxmint*)             ICON="";;
    *alpine*)                ICON="";;
    *aosc*)                  ICON="";;
    *nixos*)                 ICON="";;
    *devuan*)                ICON="";;
    *manjaro*)               ICON="";;
    *rhel*)                  ICON="";;
    *macos*)                 ICON=$'\uf179';;
    *)                       ICON="";;
esac

# native Windows (not WSL): /etc/*-release and the macOS plist won't exist
if [[ -z "$_distro" ]] && [[ -n "$WINDIR" || -n "$SYSTEMROOT" ]]; then
  ICON=$'\uf17a'
fi

# append a badge when running inside WSL
if grep -qi microsoft /proc/version 2>/dev/null; then
  ICON="${ICON} "$'\ue8e5'
fi

export STARSHIP_DISTRO="$ICON"
