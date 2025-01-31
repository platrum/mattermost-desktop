#!/bin/sh
set -e
WORKING_DIR=`pwd`
THIS_PATH=`readlink -f $0`
cd `dirname ${THIS_PATH}`
FULL_PATH=`pwd`
cd ${WORKING_DIR}
cat <<EOS > Platrum.desktop
[Desktop Entry]
Name=Mattermost
Comment=Platrum Chat application for Linux
Exec="${FULL_PATH}/platrum-chat"
Terminal=false
Type=Application
Icon=${FULL_PATH}/app_icon.png
Categories=Network;InstantMessaging;
EOS
chmod +x Platrum.desktop
