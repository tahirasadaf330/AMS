#!/bin/bash
# One-time setup of push-to-deploy on an AMS VM. Run as root ON THE SERVER:
#
#     bash /var/www/AMS/deploy/setup-push-deploy.sh
#
# Creates the bare repo, installs deploy/post-receive as its hook, and points the existing
# work tree at it. Idempotent — safe to re-run to refresh the hook after the repo's copy changes.
#
# Afterwards, from a workstation:
#     git remote add production root@<vm>:/srv/ams.git     # once
#     git push production main                             # deploys
#
# The manual deploy/deploy.sh path keeps working; nothing is removed.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/AMS}"
BARE="${BARE:-/srv/ams.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -d "$APP_DIR/.git" ] || { echo "$APP_DIR is not a git work tree" >&2; exit 1; }
[ -f "$APP_DIR/deploy/post-receive" ] || { echo "deploy/post-receive missing in $APP_DIR" >&2; exit 1; }

if [ ! -d "$BARE" ]; then
  echo "==> Creating bare repo $BARE"
  git init --bare --initial-branch="$DEPLOY_BRANCH" "$BARE"
else
  echo "==> Bare repo $BARE already exists"
fi

echo "==> Installing the post-receive hook"
install -m 0755 "$APP_DIR/deploy/post-receive" "$BARE/hooks/post-receive"

# The hook needs to know where to check out; keep it in the hook's environment rather than
# hardcoding a second copy of the path.
cat > "$BARE/hooks/post-receive.env" <<EOF
APP_DIR=$APP_DIR
GIT_DIR_BARE=$BARE
DEPLOY_BRANCH=$DEPLOY_BRANCH
EOF
chmod 600 "$BARE/hooks/post-receive.env"

echo "==> Seeding the bare repo from the work tree's current history"
if ! git --git-dir="$BARE" rev-parse --verify "$DEPLOY_BRANCH" >/dev/null 2>&1; then
  git --git-dir="$APP_DIR/.git" push --quiet "$BARE" "$DEPLOY_BRANCH:$DEPLOY_BRANCH" 2>/dev/null \
    || echo "    (could not seed automatically — the first push from a workstation will populate it)"
fi

echo
echo "==> Done."
echo "    bare repo : $BARE"
echo "    work tree : $APP_DIR"
echo "    branch    : $DEPLOY_BRANCH"
echo
echo "    Validate without deploying:"
echo "      printf '%s %s refs/heads/$DEPLOY_BRANCH\\n' \$(git --git-dir=$BARE rev-parse $DEPLOY_BRANCH) \$(git --git-dir=$BARE rev-parse $DEPLOY_BRANCH) \\"
echo "        | DRY_RUN=1 APP_DIR=$APP_DIR GIT_DIR_BARE=$BARE bash $BARE/hooks/post-receive"
echo
echo "    From a workstation:"
echo "      git remote add production root@\$(hostname -I | awk '{print \$1}'):$BARE"
echo "      git push production $DEPLOY_BRANCH"
