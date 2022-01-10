import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
// const fs = require('fs')
// const fsPromises = fs.promises

export async function getCurrentDir() {
  return resolve('./', '')
}

export async function getFile(dir: string, filename: string): Promise<string[]> {
  const dirents = readdirSync(dir, { withFileTypes: true })
  const files = await Promise.all(
    dirents.map(async dirent => {
      const res = resolve(dir, dirent.name)
      return dirent.isDirectory() ? await getFile(res, filename) : res
    }),
  )

  const arr = Array.prototype.concat(...files)

  return arr.filter(s => s.includes(filename))
}

export async function changeConstantInFiles(
  dir: string,
  filenames: string[],
  variable: string,
  value: string,
) {
  await Promise.all(filenames.map(f => changeConstantInFile(dir, f, variable, value)))
}

export async function changeConstantInFile(
  dir: string,
  filename: string,
  variable: string,
  value: string,
) {
  const filepath = (await getFile(dir, filename))[0]

  const isJsFile = filepath.indexOf('.js') !== -1

  const data = readFileSync(filepath, 'utf8')

  const regex = new RegExp(`${variable}( )*=.*`, 'g')

  let result = ''

  if (isJsFile) {
    result = data.replace(regex, `${variable} = '${value}';`)
  } else {
    result = data.replace(regex, `${variable} = ${value};`)
  }

  writeFileSync(filepath, result, 'utf8')
}
