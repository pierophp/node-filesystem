npm config set init-author-name "Name"
npm config set init-author-email "my@email.com"

git tag v0.0.28
git push origin master --tags
npm publish
