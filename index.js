const telegraf = require('telegraf')
const config = require('./config')
const data = require('./data')
const mongo = require('mongodb').MongoClient
const urlencode = require('urlencode')
const Extra = require('telegraf/extra')
const Markup = require('telegraf/markup')
const session = require('telegraf/session')
const Stage = require('telegraf/stage')
const Scene = require('telegraf/scenes/base')
const rateLimit = require('telegraf-ratelimit')
const { text } = config
const bot = new telegraf(data.token, {telegram: {webhookReply: false}})
let db 

const buttonsLimit = {
  window: 1000,
  limit: 1,
  onLimitExceeded: (ctx, next) => {
    if ('callback_query' in ctx.update)
    ctx.answerCbQuery('You`ve pressed buttons too oftern, wait.', true)
      .catch((err) => sendError(err, ctx))
  },
  keyGenerator: (ctx) => {
    return ctx.callbackQuery ? true : false
  }
}
bot.use(rateLimit(buttonsLimit))


mongo.connect(data.mongoLink, {useNewUrlParser: true}, (err, client) => {
  if (err) {
    sendError(err)
  }

  db = client.db('refbot')
  bot.startWebhook('/refbot', null, 2104)
  // bot.startPolling()
})


const stage = new Stage()
bot.use(session())
bot.use(stage.middleware())

const getNumber = new Scene('getNumber')
stage.register(getNumber)


bot.hears(/^\/start (.+[1-9]$)/, async (ctx) => {
  try {
    ctx.reply(
      text.hello + ctx.from.id,
      Extra
      .markup(Markup.inlineKeyboard([
        [Markup.urlButton('📨 Share link', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
        [Markup.callbackButton('💵 Balance', 'balance'), Markup.callbackButton('📱 My number', 'number')]
      ]))
      .webPreview(false)
    )
    
    let dbData = await db.collection('allUsers').find({userId: ctx.from.id}).toArray()
    if (dbData.length === 0 && ctx.from.id != +ctx.match[1]) {
      db.collection('allUsers').insertOne({userId: ctx.from.id, inviter: +ctx.match[1], virgin: true, paid: false, payments: 0})
    }
  } catch (err) {
    sendError(err, ctx)
  }
})

bot.start(async (ctx) => {
  try {
    ctx.reply(
      text.hello + ctx.from.id,
      Extra
      .markup(Markup.inlineKeyboard([
        [Markup.urlButton('📨 Share link', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
        [Markup.callbackButton('💵 Balance', 'balance'), Markup.callbackButton('📱 My number', 'number')]
      ]))
      .webPreview(false)
    )
    let dbData = await db.collection('allUsers').find({userId: ctx.from.id}).toArray()
    if (dbData.length === 0) {
      db.collection('allUsers').insertOne({userId: ctx.from.id, virgin: true, payments: 0})
    }
  } catch (err) {
    sendError(err, ctx)
  }
})

bot.action('main', async (ctx) => {
  ctx.answerCbQuery()
  ctx.scene.leave('getNumber')

  ctx.editMessageText(
    text.hello + ctx.from.id,
    Extra
    .markup(Markup.inlineKeyboard([
      [Markup.urlButton('📨 Share link', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
      [Markup.callbackButton('💵 Balance', 'balance'), Markup.callbackButton('📱 My number', 'number')],
    ]))
    .webPreview(false)
  )
    .catch((err) => sendError(err, ctx))
})


bot.action('balance', async (ctx) => {
  try {
    ctx.answerCbQuery()
    let notPaid = await db.collection('allUsers').find({inviter: ctx.from.id, paid: false}).toArray() // only not paid invited users
    let allRefs = await db.collection('allUsers').find({inviter: ctx.from.id}).toArray() // all invited users
    let thisUsersData = await db.collection('allUsers').find({userId: ctx.from.id}).toArray()
    let sum, payments

    if (thisUsersData[0].virgin) {
      sum = notPaid.length * 200 + 200
    } else {
      sum = notPaid.length * 200
    }
    if (thisUsersData[0].payments === 0) {
      payments = ''
    } else {
      payments = '\nУже выплачено: ' + thisUsersData[0].payments
    }
  
    ctx.editMessageText(
      'You balance now: ' + sum + ' {currency}. You`ve invited ' + allRefs.length + ' persons.' + payments,
      Extra
      .markup(Markup.inlineKeyboard([
        [Markup.callbackButton('◀️ Back', 'main'), Markup.callbackButton('💸 Withdraw', 'withdraw')]
      ]))
    )
      .catch((err) => sendError(err, ctx))
  } catch (err) {
    sendError(err, ctx)
  }
})

bot.action('withdraw', async (ctx) => {
  try {
    ctx.answerCbQuery()
    let notPaid = await db.collection('allUsers').find({inviter: ctx.from.id, paid: false}).toArray() // only not paid invited users
    let tgData = await bot.telegram.getChatMember(data.channel, ctx.from.id) // user`s status on the channel
    let subscribed, minSum
    ['creator', 'administrator', 'member'].includes(tgData.status) ? subscribed = true : subscribed = false
    let thisUsersData = await db.collection('allUsers').find({userId: ctx.from.id}).toArray()

    let sum, friendsLeft
    if (thisUsersData[0].virgin) { // if user hasn`t got gift till
      sum = notPaid.length * 200 + 200
      friendsLeft = 4 - notPaid.length
      minSum = 1000 
    } else {
      sum = notPaid.length * 200
      friendsLeft = 25 - notPaid.length
      minSum = 5000
    }

    if (!('number' in thisUsersData[0])) {
      return ctx.editMessageText(
        'You didn`t add your number.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ Main page', 'main')],
          [Markup.callbackButton('💵 Balance', 'balance'), Markup.callbackButton('📱 My number', 'number')],
        ]))
        .webPreview(false)
      )
      .catch((err) => sendError(err, ctx))
    }

    if (sum >= minSum && subscribed) {
      ctx.editMessageText(
        '✅ Your request is accepted. You`ll get message about payment as soon as or admins pay you.', 
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ Main page', 'main')]
        ]))
      )
        .catch((err) => sendError(err, ctx))
  
      bot.telegram.sendMessage( // send message to admin
        data.admins[1],
        'New request. \nUser: [' + ctx.from.first_name + '](tg://user?id=' + ctx.from.id + ')\n' +
        'The sum: ' + sum + ' {currency}. \nNumber: ' + thisUsersData[0].number,
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('✅ Paid', 'paid_' + ctx.from.id)]
        ]))
        .markdown()
      )
        .catch((err) => sendError(err, ctx))
      
      for (let key of notPaid) {
        db.collection('allUsers').updateOne({userId: key.userId}, {$set: {paid: true}}, {upsert: true}) // mark refs as paid
          .catch((err) => sendError(err, ctx))
      }

      db.collection('allUsers').updateOne({userId: ctx.from.id}, {$set: {virgin: false, payments: thisUsersData[0].payments + sum}}, {upsert: true})
        .catch((err) => sendError(err, ctx))
    } else if (sum >= minSum && !subscribed) {
      ctx.editMessageText(
        'You didn`t subscribe to the channel ' + data.chanLink + '. Make that and press "Withdraw" again.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.urlButton('📥 Subscribe the channel', data.chanLink)],
          [Markup.callbackButton('◀️ Back', 'balance')]
        ]))
        .webPreview(false)
      )
        .catch((err) => sendError(err, ctx))
    } else if (sum < minSum && subscribed) {
      ctx.editMessageText(
        'Your balance: ' + sum + ' {currency}, minimal sum for witdraw is ' + minSum +' {currency}. ' + 
        'You should invite yet : ' + friendsLeft + 
        ' more persons. \nHere`s your link, share it: t.me/RefOneBot?start=' + ctx.from.id,
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.urlButton('📨 Share link', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
          [Markup.callbackButton('◀️ Back', 'balance')]
        ]))
        .webPreview(false)
      )
        .catch((err) => sendError(err, ctx))
    } else {
      ctx.editMessageText(
        'You didn`t performed no condition. Collect 1000 {currency} by inviting friends' +
        'and subscribe the channel ' + data.chanLink + '',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.urlButton('📨 Share link', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
          [Markup.urlButton('📥 Subscribe the channel', data.chanLink)],
          [Markup.callbackButton('◀️ Back', 'balance')]
        ]))
        .webPreview(false)
      )
        .catch((err) => sendError(err, ctx))
    }
  } catch (err) {
    sendError(err, ctx)
  }
})

bot.action(/paid_[1-9]/, async (ctx) => {
  try {
    ctx.answerCbQuery()
    let userId = ctx.update.callback_query.data.substr(5)
  
    ctx.editMessageText(ctx.update.callback_query.message.text + '\n\n✅ Paid')
      .catch((err) => sendError(err, ctx))
    bot.telegram.sendMessage(userId, 'Your withdraw was paid.')
      .catch((err) => sendError(err, ctx))
  } catch (err) {
    sendError(err, ctx)
  }
})


bot.action('number', async (ctx) => {
  try {
    ctx.answerCbQuery()
    let dbData = await db.collection('allUsers').find({userId: ctx.from.id}).toArray()
    
    if ('number' in dbData[0]) {
      ctx.editMessageText(
        'Your number: ' + dbData[0].number + '\n❗️ Check it! On this num we will withdraw your money.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ Back', 'main'), Markup.callbackButton('🖊 Edit', 'get_number')]
        ])) 
        )
          .catch((err) => sendError(err, ctx))
    } else {
      ctx.editMessageText(
        'You didn`t added your number yet.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ Back', 'main'), Markup.callbackButton('🖊 Add num', 'get_number')]
        ]))
      )
        .catch((err) => sendError(err, ctx))
    }
  } catch (err) {
    sendError(err, ctx)
  }
  
})

bot.action('get_number', async (ctx) => {
  try {
    ctx.answerCbQuery()
    ctx.scene.enter('getNumber')
  
    ctx.editMessageText(
      'Enter your number in form +998971234567:',
      Extra
      .markup(Markup.inlineKeyboard([
        [Markup.callbackButton('◀️ Отменить', 'number')]
      ]))
      )
        .catch((err) => sendError(err, ctx))
  } catch (err) {
    sendError(err, ctx)
  }
})

getNumber.hears(/^.+998[0-9]{9}$/, async (ctx) => { // replace 998 to your country`s code or turn off regexp
  ctx.reply('Ваш номер: ' + ctx.message.text,
    Extra
    .markup(Markup.inlineKeyboard([
      [Markup.callbackButton('◀️ Back', 'main'), Markup.callbackButton('🖊 Edit', 'get_number')]
    ]))
  )
    .catch((err) => sendError(err, ctx))

  db.collection('allUsers').updateOne({userId: ctx.from.id}, {$set: {number: ctx.message.text}}, {upsert: true})
  .catch((err) => sendError(err, ctx))
  ctx.scene.leave('getNumber')
})


bot.command('getmembers', async (ctx) => {
  if (data.admins.includes(ctx.from.id)) {
    try {
      let dbData = await db.collection('allUsers').find({}).toArray()
      ctx.reply('🌀 All users: ' + dbData.length)
    } catch (err) {
      sendError(err, ctx)
    }
  }
})


async function sendError(err, ctx) {
  console.log(err.toString())
  if (ctx != undefined) {
    if (err.code === 400) {
      return setTimeout(() => {
        ctx.answerCbQuery()
        ctx.editMessageText(
          text.hello + ctx.from.id,
          Extra
          .markup(Markup.inlineKeyboard([
            [Markup.urlButton('📨 Share link', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
            [Markup.callbackButton('💵 Balance', 'balance'), Markup.callbackButton('📱 My number', 'number')],
          ]))
          .webPreview(false)
        )
      }, 500)
    } else if (err.code === 429) {
      return ctx.editMessageText(
        'You`ve pressed buttons too often and were blocked by Telegram' +
        'Wait some minutes and try again'
      )
    }

    bot.telegram.sendMessage(data.admins[0], '[' + ctx.from.first_name + '](tg://user?id=' + ctx.from.id + ') has got an error.\nError text: ' + err.toString(), {parse_mode: 'markdown'})
  } else {
    bot.telegram.sendMessage(data.admins[0], 'There`s an error:' + err.toString())
  }
}

bot.catch((err) => {
  sendError(err)
})

process.on('uncaughtException', (err) => {
  sendError(err)
})