module.exports = function(github_username, size) {
    let url = 'https://avatars.githubusercontent.com/trueb2';
    if (size) url += `?s=${size}`;
    return url;
};