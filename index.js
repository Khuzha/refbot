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
    ctx.answerCbQuery('Вы нажимаете на кнопки слишком часто, подождите немного.', true)
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
        [Markup.urlButton('📨 Поделиться ссылкой', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
        [Markup.callbackButton('💵 Баланс', 'balance'), Markup.callbackButton('📱 Мой номер', 'number')]
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
        [Markup.urlButton('📨 Поделиться ссылкой', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
        [Markup.callbackButton('💵 Баланс', 'balance'), Markup.callbackButton('📱 Мой номер', 'number')]
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
      [Markup.urlButton('📨 Поделиться ссылкой', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
      [Markup.callbackButton('💵 Баланс', 'balance'), Markup.callbackButton('📱 Мой номер', 'number')],
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
      'Ваш баланс на данный момент составляет ' + sum + ' сум. Вы пригласили ' + allRefs.length + ' человек.' + payments,
      Extra
      .markup(Markup.inlineKeyboard([
        [Markup.callbackButton('◀️ Назад', 'main'), Markup.callbackButton('💸 Вывести деньги', 'withdraw')]
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
        'Вы не указали номер, на который нужно вывести деньги.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ На главную', 'main')],
          [Markup.callbackButton('💵 Баланс', 'balance'), Markup.callbackButton('📱 Мой номер', 'number')],
        ]))
        .webPreview(false)
      )
      .catch((err) => sendError(err, ctx))
    }

    if (sum >= minSum && subscribed) {
      ctx.editMessageText(
        '✅ Ваша заявка на вывод принята, как только Вам выплатят деньги, Вы получите сообщение.', 
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ На главную', 'main')]
        ]))
      )
        .catch((err) => sendError(err, ctx))
  
      bot.telegram.sendMessage( // send message to admin
        data.admins[1],
        'Заявка на вывод. \nЮзер: [' + ctx.from.first_name + '](tg://user?id=' + ctx.from.id + ')\n' +
        'Сумма: ' + sum + ' сум. \nНомер: ' + thisUsersData[0].number,
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('✅ Оплатил', 'paid_' + ctx.from.id)]
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
        'Вы не подписались на канал ' + data.chanLink + '. Сделайте это и нажмите кнопку "Вывести деньги" снова.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.urlButton('📥 Подписаться на канал', data.chanLink)],
          [Markup.callbackButton('◀️ Назад', 'balance')]
        ]))
        .webPreview(false)
      )
        .catch((err) => sendError(err, ctx))
    } else if (sum < minSum && subscribed) {
      ctx.editMessageText(
        'Ваш баланс: ' + sum + ' сум, минимальная сумма вывода — ' + minSum +' сум. ' + 
        'Вам нужно пригласить еще человек: ' + friendsLeft + 
        '. \nВот Ваша ссылка, поделитесь ею: t.me/RefOneBot?start=' + ctx.from.id,
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.urlButton('📨 Поделиться ссылкой', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
          [Markup.callbackButton('◀️ Назад', 'balance')]
        ]))
        .webPreview(false)
      )
        .catch((err) => sendError(err, ctx))
    } else {
      ctx.editMessageText(
        'Вы не выполнили ни одного из условий. Наберите 1000 сум, пригласив друзей по Вашей реферальной ссылке ' +
        'и подпишитесь на канал ' + data.chanLink + '',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.urlButton('📨 Поделиться ссылкой', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
          [Markup.urlButton('📥 Подписаться на канал', data.chanLink)],
          [Markup.callbackButton('◀️ Назад', 'balance')]
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
  
    ctx.editMessageText(ctx.update.callback_query.message.text + '\n\n✅ Оплачено')
      .catch((err) => sendError(err, ctx))
    bot.telegram.sendMessage(userId, 'Ваша заявка на вывод денег была оплачена.')
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
        'Ваш номер: ' + dbData[0].number + '\n❗️ Проверьте его, именно на него будет произведена оплата.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ Назад', 'main'), Markup.callbackButton('🖊 Изменить', 'get_number')]
        ])) 
        )
          .catch((err) => sendError(err, ctx))
    } else {
      ctx.editMessageText(
        'Вы еще не указали свой номер.',
        Extra
        .markup(Markup.inlineKeyboard([
          [Markup.callbackButton('◀️ Назад', 'main'), Markup.callbackButton('🖊 Добавить', 'get_number')]
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
      'Введите Ваш номер в формате +998971234567:',
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

getNumber.hears(/^.+998[0-9]{9}$/, async (ctx) => {
  ctx.reply('Ваш номер: ' + ctx.message.text,
    Extra
    .markup(Markup.inlineKeyboard([
      [Markup.callbackButton('◀️ Назад', 'main'), Markup.callbackButton('🖊 Изменить', 'get_number')]
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
      ctx.reply('🌀 Всего юзеров запускало бота: ' + dbData.length)
    } catch (err) {
      sendError(err, ctx)
    }
  }
})


let sendError = async (err, ctx) => {
  console.log(err.toString())
  if (ctx != undefined) {
    if (err.code === 400) {
      return setTimeout(() => {
        ctx.answerCbQuery()
        ctx.editMessageText(
          text.hello + ctx.from.id,
          Extra
          .markup(Markup.inlineKeyboard([
            [Markup.urlButton('📨 Поделиться ссылкой', 't.me/share/url?url=' + urlencode(text.invite + ctx.from.id))],
            [Markup.callbackButton('💵 Баланс', 'balance'), Markup.callbackButton('📱 Мой номер', 'number')],
          ]))
          .webPreview(false)
        )
      }, 500)
    } else if (err.code === 429) {
      return ctx.editMessageText(
        'Вы нажимали на кнопки слишком часто и были заблокированы Телеграмом на некоторое время.' +
        'Попробуйте воспользоваться кнопками через несколько секунд'
      )
    }

    bot.telegram.sendMessage(data.admins[0], 'Ошибка у [' + ctx.from.first_name + '](tg://user?id=' + ctx.from.id + ')\nТекст ошибки: ' + err.toString(), {parse_mode: 'markdown'})
  } else {
    bot.telegram.sendMessage(data.admins[0], 'Ошибка:' + err.toString())
  }
}

bot.catch((err) => {
  sendError(err)
})

process.on('uncaughtException', (err) => {
  sendError(err)
})