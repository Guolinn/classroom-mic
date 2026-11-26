#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
./micturn-receiver
status=$?
if [ "$status" -ne 0 ]; then
  printf '\nReceiver stopped. Read the message above. Press Return to close.\n'
  read -r answer
fi
exit "$status"
