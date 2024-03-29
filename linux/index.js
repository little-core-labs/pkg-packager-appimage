const { appBuilderPath } = require('app-builder-bin')
const { path7za } = require('7zip-bin')
const nanoprocess = require('nanoprocess')
const mirror = require('mirror-folder')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const Batch = require('batch')
const debug = require('debug')('pkg-packager:appimage')
const copy = require('cp-file')
const path = require('path')
const fs = require('fs')

// quick util
const errback = (p, cb) => void p.then((r) => cb(null, r), cb).catch(cb)

/**
 * Maps target stage directory to `app-builder` child process.
 * @private
 * @type {Map<String,nanoprocess.Process>}
 */
const appBuilders = new Map()

/**
 * A container for the configuration used in the `app-builder`
 * binary to create an `.AppImage` binary.
 * @public
 * @class
 * @see {@link https://github.com/develar/app-builder/blob/master/pkg/package-format/appimage/configuration.go}
 */
class Configuration {

  /**
   * `Configuration` class constructor.
   * @param {Object} opts
   */
  constructor(opts) {
    this.productName = opts.productName
    this.productFileName = opts.productFileName
    this.executableName = opts.executableName
    this.systemIntegration = opts.systemIntegration || ''
    this.desktopEntry = opts.desktopEntry
    this.fileAssociations = opts.fileAssociations || []
    this.icons = opts.icons || []
  }
}

/**
 * Builder plugin for `pkg-packager` to build `.AppImage` files.
 * @public
 * @param {Target} target
 * @param {Object} opts
 * @return {Object}
 */
function appimageBuilder(target, opts) {
  const configuration = new Configuration(opts)

  const appDirectory = path.join(target.output, 'app')
  const stageDirectory = path.join(target.output, 'stage')
  const templateDirectory = path.resolve(__dirname, '..', 'template')

  const outputName = path.join(
    target.output,
    configuration.productFileName + '.AppImage')

  const appBuilder = appBuilders.get(stageDirectory) ||
    nanoprocess(appBuilderPath, [
      'appimage',
      '--no-remove-stage',
      `--configuration=${JSON.stringify(configuration)}`,
      '--output', outputName,
      '--stage', stageDirectory,
      '--app', appDirectory,
    ], {
      stdio: 'pipe',
      env: Object.assign({}, process.env, {
        PATH: [
          process.env.PATH,
          path.dirname(path7za)
        ].join(':')
      })
    })

  if (!appBuilders.has(stageDirectory)) {
    appBuilder.outputName = outputName
  }

  appBuilders.set(stageDirectory, appBuilder)

  if (opts.license) {
    appBuilder.args.push('--license', opts.license)
  }

  appBuilder.active()

  // implements `Builder` interface from `pkg-packager`
  return {
    init(callback) {
      const steps = new Batch().concurrency(1)
      steps.push((next) => rimraf(outputName, next))
      steps.push((next) => mkdirp(stageDirectory, next))
      steps.push((next) => mkdirp(appDirectory, next))

      steps.push((next) => {
        mirror(templateDirectory, appDirectory, { keepExisting: true }, next)
      })

      steps.end(callback)
    },

    build(callback) {
      const steps = new Batch().concurrency(1)

      let response = null

      steps.push((next) => {
        const basename = path.basename(target.binary)
        const destination = path.join(appDirectory, basename)
        errback(copy(target.binary, destination), next)
      })

      steps.push((next) => {
        mirror(appDirectory, stageDirectory, { keepExisting: true }, next)
      })

      if (Array.isArray(target.directories)) {
        for (const dir of target.directories) {
          try {
            const stats = fs.statSync(dir.from)
            if (!stats.isDirectory()) {
              continue
            }
          } catch (err) {
            debug(err)
            continue
          }

          const from = dir.from
          const to = path.resolve(appDirectory, dir.to || path.basename(dir))
          steps.push((next) => mkdirp(to, next))
          steps.push((next) => {
            mirror(from, to, { keepExisting: true }, next)
          })
        }
      }

      if (Array.isArray(target.symlinks)) {
        for (const symlink of target.symlinks) {
          steps.push((next) => {
            const cwd = process.cwd()
            process.chdir(appDirectory)
            const from = path.relative(appDirectory, symlink.from)
            const to = path.relative(appDirectory, symlink.to)
            fs.symlink(from, to, (err) => {
              process.chdir(cwd)
              next(err)
            })
          })
        }
      }

      appBuilder.inactive()

      if (0 === appBuilder.actives && !appBuilder.opened) {
        steps.push((next) => appBuilder.open(next))
        steps.push((next) => {
          let error = ''

          appBuilder.process.on('exit', (code, signal) => {
            if (code) {
              next(error)
            } else {
              next(null)
            }
          })

          appBuilder.process.stderr.on('data', (data) => {
            if (data) {
              error = new Error(error + '\n' + data)
            }
          })

          appBuilder.process.stdout.once('data', (data) => {
            if (data) {
              response = JSON.parse(data.toString())
              Object.assign(response, {
                name: appBuilder.outputName,
              })
            }

            appBuilder.close(() => {
              appBuilders.delete(stageDirectory)
            })
          })
        })
      }

      steps.end((err) => {
        callback(err, response)
      })
    },

    cleanup(callback) {
      const steps = new Batch()
      if (!opts.debug) {
        steps.push((next) => rimraf(stageDirectory, next))
        steps.push((next) => rimraf(appDirectory, next))
      }
      steps.end(callback)
    }
  }
}

/**
 * Module exports.
 */
module.exports = appimageBuilder
