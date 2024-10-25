#!/bin/bash

# Read current version from a separate version file
version_file="version"
package_file="package.json"

# Increment version
current_version=$(cat "$version_file")
new_version=$(echo "$current_version" | awk -F. -v OFS=. '{$NF += 1 ; print}')

# Update the version file with the new version
echo "$new_version" > "$version_file"

# Update package.json version
jq --arg new_version "$new_version" '.version = $new_version' "$package_file" > "$package_file.tmp" && mv "$package_file.tmp" "$package_file"

# Commit message with optional appended text
optional_message=${1:-""}
commit_message="chore(release): $new_version"
if [ -n "$optional_message" ]; then
  commit_message="$commit_message - $optional_message"
  git add --all  # Add all changes if an additional message is provided
else
  git add "$version_file" "$package_file"
fi

# Commit and tag the changes
git commit -m "$commit_message"
git tag -a "v$new_version" -m "Release $new_version"

# Push changes and tags to GitHub
git push origin main
git push origin "v$new_version"
