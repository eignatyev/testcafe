const { noop } = require('lodash');
const nanoid   = require('nanoid');
const expect   = require('chai').expect;

const TestRun        = require('../../lib/test-run/index');
const TestController = require('../../lib/api/test-controller');
const COMMAND_TYPE   = require('../../lib/test-run/commands/type');
const markerSymbol   = require('../../lib/test-run/marker-symbol');

let callsite = 0;

function createTestRunMock () {
    function TestRunMock () {
        this.session    = { id: nanoid(7) };
        this.test       = { name: 'Test', testFile: { filename: __filename } };
        this.debugLog   = { command: noop };
        this.controller = new TestController(this);

        this[markerSymbol] = true;
    }

    TestRunMock.prototype = TestRun.prototype;

    return new TestRunMock();
}

async function executeExpression (expression, testRun = createTestRunMock()) {
    callsite++;

    return await testRun.executeCommand({
        type: COMMAND_TYPE.executeNodeExpression,
        expression
    }, callsite.toString());
}

async function executeSyncExpression (expression, customVarName, testRun = createTestRunMock()) {
    return testRun.executeCommand({
        type:               COMMAND_TYPE.executeExpression,
        resultVariableName: customVarName,
        expression
    });
}

async function assertError (expression, expectedMessage, expectedLine, expectedColumn) {
    const WHITE_SPACES_REGEXP = /\s/g;

    let catched = false;

    try {
        await executeExpression(expression);
    }
    catch (err) {
        catched = true;

        expect(err.errMsg).eql(expectedMessage);
        expect(err.line).eql(expectedLine);
        expect(err.column).eql(expectedColumn);
        expect(err.callsite).eql(callsite.toString());
        expect(err.errStack.replace(WHITE_SPACES_REGEXP, '')).contains(expression.replace(WHITE_SPACES_REGEXP, ''));
        expect(err.errStack).contains('[JS code]');
    }

    expect(catched).eql(true);
}

describe('Code steps', () => {
    beforeEach(() => {
        callsite = 0;
    });

    it('basic', async () => {
        const res = await executeExpression('return 1+1;');

        expect(res).eql(2);
    });

    it('error', async () => {
        await assertError('u=void 0;u.t=5;', 'Cannot set property \'t\' of undefined', 1, 13, '1');

        await assertError(
            'let q = void 0;\n' +
            '        q.t = 5;'
            , 'Cannot set property \'t\' of undefined', 2, 13, '2');

        await assertError(
            'let q = 3;\n' +
            'q = 4;\n' +
            'throw new Error(\'custom error\')'
            , 'custom error', 3, 7, '3');
    });

    it('sync expression does not spoil global context', async () => {
        const testRun = createTestRunMock();

        await executeSyncExpression('1+1', 'myCustomVar1', testRun);
        await executeSyncExpression('1+myCustomVar1', 'myCustomVar2', testRun);

        expect(typeof myCustomVar1).eql('undefined');
        expect(typeof myCustomVar2).eql('undefined');

        expect(await executeSyncExpression('myCustomVar1', void 0, testRun)).eql(2);
        expect(await executeSyncExpression('myCustomVar2', void 0, testRun)).eql(3);
    });

    it('shared context with global variables', async () => {
        const testRun = createTestRunMock();

        await executeExpression('result = 10;', testRun);

        const res = await executeExpression('return result + 3', testRun);

        expect(res).eql(13);
        expect(typeof result).eql('undefined');
    });

    it('shared context with local variables', async () => {
        const testRun = createTestRunMock();

        await executeExpression('const result = 10;', testRun);

        try {
            await executeExpression('return result + 3', testRun);
        }
        catch (err) {
            expect(err.code).eql('E64');
            expect(err.errMsg).eql('result is not defined');
        }
    });

    it('different context', async () => {
        await executeExpression('result = 10;');

        try {
            await executeExpression('result + 3');
        }
        catch (err) {
            expect(err.code).eql('E64');
            expect(err.errMsg).eql('result is not defined');
        }
    });

    it('promises', () => {
        return executeExpression(`
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    resolve('hooray!');
                }, 20);
            });
        `)
            .then(result => {
                expect(result).eql('hooray!');
            });
    });

    it('async/await', () => {
        return executeExpression(`
            const promise = new Promise((resolve, reject) => {
                setTimeout(() => {
                    resolve('hooray!');
                }, 20);
            });
            
            const result = await promise;
            
            return result;
        `)
            .then(result => {
                expect(result).eql('hooray!');
            });
    });

    it('require - absolute', async () => {
        await executeExpression(`
            return require('testcafe-hammerhead');
        `)
            .then(result => {
                expect(result).eql(require('testcafe-hammerhead'));
            });
    });

    it('require - relative', async () => {
        await executeExpression(`
            return require('./helpers/console-wrapper');
        `)
            .then(result => {
                expect(result).eql(require('./helpers/console-wrapper'));
            });
    });

    it('globals', async () => {
        const result = await executeExpression(`
            Buffer.from('test');

            const timeout   = setTimeout(function () {});
            const immediate = setImmediate(function () {});
            const interval  = setInterval(function () {});

            clearTimeout(timeout);
            clearImmediate(immediate);
            clearInterval(interval);
            
            return { __dirname, __filename };
        `);

        expect(result.__dirname).eql(__dirname);
        expect(result.__filename).eql(__filename);
    });

    it('Selector/ClientFunction', async () => {
        await executeExpression(`
            const selector       = Selector('button');
            const clientFunction = ClientFunction(() => {});
        `);
    });

    describe('test controller', () => {
        it('basic', async () => {
            await executeExpression(`
                await t.wait(10);
            `);
        });

        it('shared context', async () => {
            const testRun = createTestRunMock();

            await executeExpression(`
                t.testRun.sharedVar = 1;
            `, testRun);

            await executeExpression(`
                if (!t.testRun.sharedVar)
                    t.testRun.sharedVar = 2;
            `, testRun);

            expect(testRun.sharedVar).eql(1);
        });

        it('different context', async () => {
            const testRun1 = createTestRunMock();
            const testRun2 = createTestRunMock();

            await executeExpression(`
                t.testRun.sharedVar = 1;
            `, testRun1);

            await executeExpression(`
                if (!t.testRun.sharedVar)
                    t.testRun.sharedVar = 2;
            `, testRun2);

            expect(testRun1.sharedVar).eql(1);
            expect(testRun2.sharedVar).eql(2);
        });
    });
});
