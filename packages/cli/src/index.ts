#!/usr/bin/env node

/**
 * @deluthium/cli
 *
 * Interactive CLI for setting up Deluthium adapter integrations.
 *
 * Usage:
 *   npx @deluthium/cli init          # Interactive project setup
 *   npx @deluthium/cli list          # List available adapters
 *   npx @deluthium/cli info <name>   # Show adapter details
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { checkbox, input, confirm } from '@inquirer/prompts';
import ora from 'ora';
import { resolve } from 'node:path';
import { ADAPTERS, ADAPTER_CHOICES } from './config.js';
import { scaffoldProject } from './scaffolder.js';

const program = new Command();

program
  .name('deluthium')
  .description('Interactive CLI for Deluthium connector setup')
  .version('0.1.0');

// ─── init command ────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a new Deluthium integration project')
  .option('-d, --directory <path>', 'Target directory', '.')
  .option('--no-install', 'Skip dependency installation')
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.cyan('  Deluthium Connector Setup'));
    console.log(chalk.dim('  Configure your integration adapters\n'));

    // Project name
    const projectName = await input({
      message: 'Project name:',
      default: 'my-deluthium-integration',
      validate: (v) => (v.trim().length > 0 ? true : 'Name is required'),
    });

    // Select adapters
    console.log('');
    const selectedAdapters = await checkbox({
      message: 'Which systems do you want to connect?',
      choices: ADAPTER_CHOICES,
      required: true,
    });

    if (selectedAdapters.length === 0) {
      console.log(chalk.yellow('\nNo adapters selected. Exiting.'));
      process.exit(0);
    }

    // Collect config for each adapter
    const configValues: Record<string, Record<string, string | number | boolean>> = {};

    for (const adapterKey of selectedAdapters) {
      const info = ADAPTERS[adapterKey];
      if (!info) continue;

      console.log(chalk.bold(`\n  Configure ${info.label}:`));
      const values: Record<string, string | number | boolean> = {};

      for (const field of info.configFields) {
        const envHint = chalk.dim(` (will be stored in .env)`);

        if (field.secret) {
          const wantNow = await confirm({
            message: `Set ${field.label} now?${envHint}`,
            default: false,
          });

          if (wantNow) {
            const val = await input({
              message: `  ${field.label}:`,
              validate: field.required
                ? (v) => (v.trim().length > 0 ? true : `${field.label} is required`)
                : () => true,
            });
            values[field.key] = val;
          } else {
            values[field.key] = '';
          }
        } else if (field.type === 'number') {
          const val = await input({
            message: `  ${field.label} (${field.description}):`,
            default: field.default !== undefined ? String(field.default) : undefined,
          });
          values[field.key] = Number(val) || (field.default as number) || 0;
        } else if (field.type === 'boolean') {
          const val = await confirm({
            message: `  ${field.label}?`,
            default: field.default as boolean | undefined,
          });
          values[field.key] = val;
        } else {
          const val = await input({
            message: `  ${field.label} (${field.description}):`,
            default: field.default !== undefined ? String(field.default) : undefined,
            validate: field.required
              ? (v) => (v.trim().length > 0 ? true : `${field.label} is required`)
              : () => true,
          });
          values[field.key] = val;
        }
      }

      configValues[adapterKey] = values;
    }

    // Scaffold
    console.log('');
    const targetDir = resolve(options.directory, projectName);
    const spinner = ora('Scaffolding project...').start();

    try {
      const files = await scaffoldProject({
        directory: targetDir,
        adapters: selectedAdapters,
        configValues,
        projectName,
      });

      spinner.succeed(`Created ${files.length} files in ${chalk.cyan(targetDir)}`);

      // Summary
      console.log('');
      console.log(chalk.bold('  Created files:'));
      for (const file of files) {
        console.log(chalk.dim(`    ${file}`));
      }

      console.log('');
      console.log(chalk.bold('  Next steps:'));
      console.log(chalk.dim(`    cd ${projectName}`));
      if (!options.noInstall) {
        console.log(chalk.dim('    npm install'));
      }
      console.log(chalk.dim('    # Edit .env with your API keys'));
      console.log(chalk.dim('    npm start'));

      if (selectedAdapters.includes('hummingbot')) {
        console.log('');
        console.log(chalk.bold('  Hummingbot setup:'));
        console.log(chalk.dim('    pip install deluthium-hummingbot'));
        console.log(chalk.dim('    deluthium-hummingbot install --hummingbot-dir /path/to/hummingbot'));
      }

      console.log('');
    } catch (err) {
      spinner.fail('Failed to scaffold project');
      console.error(err);
      process.exit(1);
    }
  });

// ─── list command ────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all available adapters')
  .action(() => {
    console.log('');
    console.log(chalk.bold.cyan('  Available Deluthium Adapters\n'));

    const maxNameLen = Math.max(...Object.values(ADAPTERS).map((a) => a.label.length));

    for (const [key, info] of Object.entries(ADAPTERS)) {
      const lang = info.language === 'both' ? 'TS+Py' : info.language === 'python' ? 'Python' : 'TS';
      const langBadge = chalk.dim(`[${lang}]`);
      const paddedName = info.label.padEnd(maxNameLen + 2);

      console.log(
        `  ${chalk.green(key.padEnd(14))} ${chalk.bold(paddedName)} ${chalk.dim(info.description)} ${langBadge}`,
      );
    }

    console.log('');
    console.log(chalk.dim('  Run `deluthium info <name>` for details on a specific adapter.'));
    console.log('');
  });

// ─── info command ────────────────────────────────────────────────────────────

program
  .command('info <adapter>')
  .description('Show detailed info about an adapter')
  .action((adapterName: string) => {
    const info = ADAPTERS[adapterName];
    if (!info) {
      console.error(chalk.red(`\n  Unknown adapter: "${adapterName}"`));
      console.error(chalk.dim(`  Run \`deluthium list\` to see available adapters.\n`));
      process.exit(1);
    }

    console.log('');
    console.log(chalk.bold.cyan(`  ${info.label}`));
    console.log(chalk.dim(`  ${info.description}\n`));

    console.log(chalk.bold('  Package:'), info.package);
    console.log(chalk.bold('  Language:'), info.language === 'both' ? 'TypeScript + Python' : info.language);
    console.log('');

    console.log(chalk.bold('  Configuration:'));
    for (const field of info.configFields) {
      const req = field.required ? chalk.red('*') : ' ';
      const def = field.default !== undefined ? chalk.dim(` (default: ${field.default})`) : '';
      console.log(`    ${req} ${chalk.green(field.key)} -- ${field.description}${def}`);
    }

    console.log('');
    console.log(chalk.bold('  Install:'));
    if (info.npmDependencies.length > 0) {
      console.log(chalk.dim(`    npm install ${info.npmDependencies.join(' ')}`));
    }
    if (info.pipDependencies && info.pipDependencies.length > 0) {
      console.log(chalk.dim(`    pip install ${info.pipDependencies.join(' ')}`));
    }

    console.log('');
    console.log(chalk.bold('  Quick Start:'));
    console.log(chalk.dim('    ' + info.importExample));
    console.log('');
  });

// ─── Parse & Run ─────────────────────────────────────────────────────────────

program.parse();
