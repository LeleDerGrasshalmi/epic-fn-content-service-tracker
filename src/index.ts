import { execSync } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';

import env from './utils/env.js';
import hosts from './resources/hosts.js';
import files from './resources/files.js';
import getRemoteContent from './utils/get-remote-content.js';
import path from 'path';

const outputFolder = 'output';

const main = async () => {
  const hostEntries = Object.entries(hosts);

  for (let i = 0; i < hostEntries.length; i += 1) {
    const [deployment, host] = hostEntries[i];
    const deploymentFolder = `${outputFolder}/${deployment}`;

    if (!fs.existsSync(deploymentFolder)) {
      await fsp.mkdir(deploymentFolder, { recursive: true });
    }

    for (let j = 0; j < files.length; j += 1) {
      const file = files[j];
      const { success, content } = await getRemoteContent(`https://${host}${file}`);

      if (success) {
        const filePath = `${deploymentFolder}${file}`;
        const fileDir = path.parse(filePath).dir;

        if (!fs.existsSync(fileDir)) {
          await fsp.mkdir(fileDir, { recursive: true });
        }

        await fsp.writeFile(filePath, content);
      }
    }

    const gitStatus = execSync(`git status ${deploymentFolder}`)?.toString('utf-8') || '';
    const isModified = gitStatus.includes(outputFolder);

    if (!isModified) {
      continue;
    }

    const commitMessage = `Modified ${deployment}`;

    console.info(commitMessage);

    if (env.GIT_DO_NOT_COMMIT?.toLowerCase() === 'true') {
      continue;
    }

    execSync('git add output');
    execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config commit.gpgsign false');
    execSync(`git commit -m "${commitMessage}"`);
  }

  if (env.GIT_DO_NOT_PUSH?.toLowerCase() === 'true') {
    return;
  }

  execSync('git push');
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
