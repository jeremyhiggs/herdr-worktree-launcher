import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFileName } from '../mods/worktree-launcher/project-name.js';

const hex = text => Buffer.from(text).toString('hex');
test('root package names take priority, drop npm scopes, and leave unusable names to Python metadata', () => {
  const python = hex('[project]\nname = "python-app"\n');
  assert.equal(projectFileName(hex('{"name":"@team/node-app"}'), python), 'node-app');
  for (const text of ['{broken', '{}', 'null', '{"name":"../../escape"}', '{"name":"."}', '{"name":"bad/name"}', '{"name":3}', '\0{"name":"binary"}']) {
    assert.equal(projectFileName(hex(text), python), 'python-app', text);
  }
  assert.equal(projectFileName(hex('\uFEFF{"name":"node-app"}')), 'node-app');
});

test('Python names use literal project metadata before Poetry and ignore names inside other values', () => {
  for (const text of [
    '[project]\nname = "python-app" # a comment\n',
    "['project']\n'name' = 'python-app'\n",
    'project.name = "python-app"\n',
    '[tool.poetry]\nname = "older-name"\n[project]\nname = "python-app"\n',
    '[project]\nname = """python-app"""\n',
    '[project]\nname = """\npython-app"""\n',
    '[project]\nname = "python\\u002dapp"\n',
    '[project]\nname = "python\\U0000002dapp"\n',
    '[build-system]\nrequires = ["setuptools", "wheel"]\n[project]\nname = "python-app"\n',
    '[[plugins]]\nproject.name = "plugin-app"\n[project]\nname = "python-app"\n',
    '[project]\ndescription = """\n[project]\nname = "pretend"\n"""\nname = "python-app"\n',
    "[project]\ndescription = '''\n[project]\nname = 'pretend'\n'''\nname = 'python-app'\n",
  ]) assert.equal(projectFileName('', hex(text)), 'python-app', text);
  assert.equal(projectFileName('', hex('[tool.poetry]\nname = "poetry-app"\n')), 'poetry-app');
  assert.equal(projectFileName('', hex('[project]\nname = "app\\u002dface"\n')), 'app-face');
  for (const text of [
    '[build-system]\nname = "other"\n', '"project.name" = "other"\n',
    '[[plugins]]\nproject.name = "plugin-app"\n',
    '[project]\nname = "app\\u0000002d"\n',
    '[project]\nname = "@team/invalid-python-name"\n', '[project]\nname = "../escape"\n',
    '[project]\nname = "first"\nname = "second"\n', '[project]\ndescription = """unterminated\nname = "pretend"\n',
    '[project]\nname = "invalid\\\ncontinuation"\n',
  ]) assert.equal(projectFileName('', hex(text)), null, text);
});

test('manifest reads reject oversized, binary, invalid UTF-8, and malformed transport data', () => {
  assert.equal(projectFileName(hex('{"name":"too-big","description":"' + 'x'.repeat(65536) + '"}')), null);
  assert.equal(projectFileName('0'), null); assert.equal(projectFileName('not-hex'), null);
  assert.equal(projectFileName('ff'), null);
  assert.equal(projectFileName('', hex('[project]\nname = "good\0bad"\n')), null);
});
