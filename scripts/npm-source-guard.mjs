/** 仓库维护源码；客户安装包必须经过精简构建，避免直接交付开发目录。 */
console.error('请运行 npm run pack:npm，生成 dist/shroom-sdk-<版本>.tgz。不要直接在源码仓库运行 npm pack / npm publish。');
process.exitCode = 1;
