import {CompletionList, customEvent, lastWordSuggestion, Range} from "../../../types/ClientTypes";
import Log from "../../../log";
import {magicObjects} from "../../../magicobjects";
import {allFiles, allHtml} from "../../../allFiles";
import {
    createRefsStr,
    findAccordingRow,
    getAccordingRefs, getFirstXDataTagName,
    getParentAndOwnIdScopes,
    getParentAndOwnVariables, getParentAndOwnVariablesJustNamesNoFunctions, getParentAndOwnVariablesXData
} from "../../../cheerioFn";
import {requestingMethods} from "../../../typescriptLsp/typescriptServer";
import {addNecessaryCompletionItemProperties, completionResponseType} from "../completion";
import {PageHtml} from "../../../HtmlParsing/PageHtml";
import {
    getJsCodeInQuotationMarksWithProperFormating
} from "../javascriptText";
import {getKeyword, getLastWordWithUriAndRange} from "../../../analyzeFile";
import cheerio, {Cheerio, Element} from "cheerio";
import {CompletionItem} from "../../../types/completionTypes";
import {positionTreeSitter, rangeIndexTreesitter} from "../../../treeSitterHmtl";
export const completionJs  = async (line : number, character : number, uri : string | undefined, javascriptPos : rangeIndexTreesitter) : Promise<CompletionList | null> => {
    const javascriptText = allFiles.get(uri!)!.substring(javascriptPos.startIndex,javascriptPos.endIndex)
    Log.writeLspServer('completionJS requested')
    const wholeLine = allHtml.get(uri!)!.linesArr[line]
    let lastWordSuggestion = getLastWordWithUriAndRange(uri!, {
        character,
        line
    })
    const htmpPage = allHtml.get(uri!)
    const node = findAccordingRow(line, htmpPage!)
    if (!node){
        Log.writeLspServer(' matching node could not be found aborting')

        return null
    }
    Log.writeLspServer('check if inside id function')
    if (isWithinId(lastWordSuggestion,character))
    {
        Log.writeLspServer('is inside id function')
        const res = getParentAndOwnIdScopes(node!)

        return {
            isIncomplete: false,
            items: addNecessaryCompletionItemProperties(res, line,character)
        }
    }
    if (isInsideDispatchSetEvent(wholeLine, character))
    {
        const events = PageHtml.getAllListedToEvents()
        Log.writeLspServer('should return listed to events',1)
        Log.writeLspServer(events,1)

        return {
            isIncomplete : false,
            items: addNecessaryCompletionItemProperties(events, line, character)
        }
    }
    let optionsStr : string[] = []

    const parentAndOwnVariables = getParentAndOwnVariables(node)
    optionsStr.push(...parentAndOwnVariables)

    Log.writeLspServer('check if inside watch')
    if (isInsideWatch(lastWordSuggestion,character))
    {
        Log.writeLspServer('is inside watch')
        let text = createBlankJavascriptWithBBB(line,character)
        text += optionsStr.map(x => 'var ' + x + ';' ).join('')
        const allKeys : string[] = []
        getParentAndOwnVariablesJustNamesNoFunctions(node,allKeys)
        text += 'var bbb = {'
        text += allKeys.map(item => item.replace('"','')).join(', ')
        text += ' }'
        const res = await requestingMethods( 'completion', text, line, character)
        const message = res as completionResponseType
            //@ts-ignore
        const items = message.result.items as unknown as CompletionItem[]
        const output: CompletionItem[] = items.map(x => {
            return {
                label: x.label,
                kind: x.kind,
            }
        })
        return {
            isIncomplete: true,
            items: output
        }
    }

    optionsStr.push(...magicObjects)
    optionsStr.push(createMagicElVariable(node!))
    const magicEventStr = addMagicEventVariableIfEvent(uri!,line,character)
    if (magicEventStr != '') optionsStr.push(magicEventStr)
    let javascriptTextProperFormating = getJsCodeInQuotationMarksWithProperFormating(javascriptText,javascriptPos.positionStart.row, javascriptPos.positionStart.column)

    optionsStr.push(createDataMagicElement(node))
    const rootElement = createMagicRootVariable(node)
    if (rootElement) optionsStr.push(rootElement)

    javascriptTextProperFormating += optionsStr.map(x => 'var ' + x + ';' ).join('')
    javascriptTextProperFormating +=  (magicObjects.map(x => ' var ' + x +'; ').join(''))

    const refs = getAccordingRefs(node!)
    if (refs.length != 0)
    {
        javascriptTextProperFormating += createRefsStr(refs)
    }
    const res = await requestingMethods( 'completion', javascriptTextProperFormating, line, character)
    if (res)
    {
        const message = res as completionResponseType
        //@ts-ignore
        const items = message.result.items

        return {
            isIncomplete: true,
            items: items
        }
    }

    return null
}

export function createMagicRootVariable(node : Cheerio<Element>)
{
    const res = getFirstXDataTagName(node)
    if (!res) return null

    return '$root = document.createElement("' + res + '")'
}

function createBlankJavascriptWithBBB(line : number, character : number)
{
    let output = ''
    for (let i = 0; i < line; i++) {
        output += '\n'
    }
    for (let i = 0; i < character-4; i++) {
        output+= ' '
    }
    output+= 'bbb.'
    for (let i = 0; i < 500; i++) {
        output+= '\n'
    }
    return output
}

function isInsideWatch(lastWordSuggestion : lastWordSuggestion, character : number)
{
    return  lastWordSuggestion.wholeLineTillEndofWord.substring(0,character).match(/\$watch\(\s*'$/) != null
}
export function createMagicElVariable(node : Cheerio<Element> )
{
    return '$el = document.createElement("' + node[0].tagName + '") '
}

export function createDataMagicElement(node : Cheerio<Element>)
{
    let output = '$data = { '
    const variables : string[] = []
    Log.writeLspServer('yoyoyo',1)
    getParentAndOwnVariablesXData(node,variables)
    Log.writeLspServer(variables)

    output += variables.map(item => item.replace('"','')).join(', ')
    output += ' }'
    Log.writeLspServer('the output : ' + output)
    return output
}
export function addMagicEventVariableIfEvent(uri: string, line: number, character : number) : string
{

    const keyWord = getKeyword(uri,line,character)
    Log.writeLspServer('compeltionjs3 key ' + keyWord, 1)
    let eventText = ''
    if (keyWord[0] === '@' || keyWord.indexOf('x-on:') === 0)
    {
        Log.writeLspServer('gets that it is an event ' + keyWord,1)
        let indexFirstPoint = keyWord.indexOf('.')
        if (indexFirstPoint == -1) {
            indexFirstPoint = keyWord.length

        }
        let indexEventNameStarts = 1
        if (keyWord.indexOf('x-on:') === 0)
        {
            indexEventNameStarts = 5
        }
        const eventName = keyWord.substring(indexEventNameStarts, indexFirstPoint)
        Log.writeLspServer('the detected eventNa,e ' + eventName ,1)
        for (let key of allHtml.keys()) {
            allHtml.get(key)!.events.forEach(item => {
                if (item.name == eventName)
                {
                    eventText+= buildMagiceventVar(item)
                }
            })
        }
    }
    return eventText
}

function isWithinId(lastword : lastWordSuggestion, character : number): Boolean
{
    Log.writeLspServer('checks whether insode id')
    const regExp = /\$id\(\s*'*$/
    const match = lastword.wholeLineTillEndofWord.substring(0,character).match(regExp)
    Log.writeLspServer(match)
    if (!match) return false
    return true
}
function isWithInDispatch(javascriptText : string, line : number, character : number, position : rangeIndexTreesitter): Boolean
{
    Log.writeLspServer('checks whether insode dispatch')
    const textWithinParenthesis = javascriptText
    Log.writeLspServer(textWithinParenthesis)
    const regExp = /\$dispatch\([\s\S]*\)/
    const match = textWithinParenthesis.match(regExp)
Log.writeLspServer('jjjjjjjjjjjjjjjj ' + match,1)
    if (!match) return false
    const h = javascriptText.substring(0,match.index).split('\n')
    const newLineCountBefore = h.length - 1
    let characterRelativeStart = h[h.length-1].length
    if (h.length == 1)
    {
        characterRelativeStart += character
    }
    const splitLines = match[0].split('\n')
    const countNewLines = splitLines.length - 1
    let characterEnd = splitLines[splitLines.length -1].length
    if (countNewLines == 0 && newLineCountBefore == 0 )
    {
        characterEnd += character
    }
    const endPosition : positionTreeSitter= {
        row : position.positionStart.row + newLineCountBefore + countNewLines ,
        column : characterEnd
    }
    Log.writeLspServer('endposition : ' + JSON.stringify(endPosition),1)
    const startPosition : positionTreeSitter = {
        row : position.positionStart.row + newLineCountBefore,
        column : characterRelativeStart
    }
    Log.writeLspServer('startPosition : ' + JSON.stringify(startPosition),1)
    if (line <= endPosition.row && line >= startPosition.row && (
        (
            startPosition.row != line || startPosition.column <= character
        )
        &&
        (
            endPosition.row != line || endPosition.column >= character
        )
    ))
    {
        return true
    }
    return false

}


function isInsideDispatchSetEvent(wholeLine : string, character: number) : Boolean
{
    const regExpEnd = /\$dispatch\([\s]*'$/
    if (wholeLine.substring(0, character).match(regExpEnd))
    {

        return true
    }

    return false
}




function buildMagiceventVar(item : customEvent )
{
    const keys = Object.keys(item.details)
    let tempStr = keys.map(key => {
        let tempStr = ' '
        tempStr += key
        tempStr += ' : '
        tempStr += item.details[key]
        return tempStr
    }).join(',')

    return  '$event = ' + '{ detail: { ' +  tempStr   +  '  }, srcElement : { dispatchEvent: 5 } } '
}


function changeXForForTypescriptServer(content : string): string
{
    const regExp = /([a-z-]+)(\s+)in(\s+)([a-z-]+)/g
    let test = content
    let match
    while ((match = regExp.exec(content)) != null)
    {
        Log.writeLspServer('found match at index ' + match.index)
        Log.writeLspServer(match)
        const arrName = match[4]
        const keyName = match[1]
        const firstWhite = match[2]
        const secondWhite = match[3]
        const newText = 'for(let ' + keyName + firstWhite + 'of' + secondWhite + arrName + "){"
        Log.writeLspServer(newText)
        let textToReplace = '       ' + match[0] + '  '
        let counter  = 0
        do {
            textToReplace = textToReplace.substring(0, textToReplace.length - 2)
            counter++
        }while (content.indexOf(textToReplace) == -1 && counter < 2)
        Log.writeLspServer(content.indexOf(textToReplace).toString())
        test = test.replaceAll(textToReplace, newText)
    }
    return test
}







