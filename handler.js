const { Function: Func, Logs, Scraper } = new(require('@neoxr/wb'))
const env = require('./config.json')
const cron = require('node-cron')
const cache = new(require('node-cache'))({
   stdTTL: env.cooldown
})
const fs = require('fs')
const os = require('os')
module.exports = async (client, ctx) => {
   const { store, m, body, prefix, args, command, text, prefixes } = ctx
   try {
      require('./lib/system/schema')(m, env) /* input database */
      const isOwner = [client.decodeJid(client.user.id).split `@` [0], env.owner, ...global.db.setting.owners].map(v => v + '@s.whatsapp.net').includes(m.sender)
      const isPrem = (global.db.users.some(v => v.jid == m.sender) && global.db.users.find(v => v.jid == m.sender).premium)
      const groupMetadata = m.isGroup ? await client.groupMetadata(m.chat) : {}
      const participants = m.isGroup ? groupMetadata.participants : [] || []
      const adminList = m.isGroup ? await client.groupAdmin(m.chat) : [] || []
      const isAdmin = m.isGroup ? adminList.includes(m.sender) : false
      const isBotAdmin = m.isGroup ? adminList.includes((client.user.id.split `:` [0]) + '@s.whatsapp.net') : false
      const blockList = typeof await (await client.fetchBlocklist()) != 'undefined' ? await (await client.fetchBlocklist()) : []
      const groupSet = global.db.groups.find(v => v.jid == m.chat),
         chats = global.db.chats.find(v => v.jid == m.chat),
         users = global.db.users.find(v => v.jid == m.sender),
         setting = global.db.setting
      Logs(client, m, false, 1) /* 1 = print all message, 0 = print only cmd message */
      if (!setting.online) client.sendPresenceUpdate('unavailable', m.chat)
      if (setting.online) {
         client.sendPresenceUpdate('available', m.chat)
         client.readMessages([m.key])
      }
      if (m.isGroup && !isBotAdmin) {
         groupSet.localonly = false
      }
      if (!users) global.db.users.push({
         jid: m.sender,
         banned: false,
         limit: env.limit,
         hit: 0,
         spam: 0
      })
      if (setting.debug && !m.fromMe && isOwner) client.reply(m.chat, Func.jsonFormat(m), m)
      if (m.isGroup && !groupSet.stay && (new Date * 1) >= groupSet.expired && groupSet.expired != 0) {
         return client.reply(m.chat, Func.texted('italic', '🚩 Bot time has expired and will leave from this group, thank you.', null, {
            mentions: participants.map(v => v.id)
         })).then(async () => {
            groupSet.expired = 0
            await Func.delay(2000).then(() => client.groupLeave(m.chat))
         })
      }
      if (users && (new Date * 1) >= users.expired && users.expired != 0) {
         return client.reply(users.jid, Func.texted('italic', '🚩 Your premium package has expired, thank you for buying and using our service.')).then(async () => {
            users.premium = false
            users.expired = 0
            users.limit = env.limit
         })
      }
      if (m.isGroup) groupSet.activity = new Date() * 1
      if (users) users.lastseen = new Date() * 1
      if (chats) {
         chats.chat += 1
         chats.lastseen = new Date * 1
      }
      if (m.isGroup && !m.isBot && users && users.afk > -1) {
         client.reply(m.chat, `You are back online after being offline for : ${Func.texted('bold', Func.toTime(new Date - users.afk))}\n\n• ${Func.texted('bold', 'Reason')}: ${users.afkReason ? users.afkReason : '-'}`, m)
         users.afk = -1
         users.afkReason = ''
      }
      cron.schedule('00 00 * * *', () => {
         setting.lastReset = new Date * 1
         global.db.users.filter(v => v.limit < env.limit && !v.premium).map(v => v.limit = env.limit)
         Object.entries(global.db.statistic).map(([_, prop]) => prop.today = 0)
      }, {
         scheduled: true,
         timezone: process.env.TZ
      })
      if (m.isGroup && !m.fromMe) {
         let now = new Date() * 1
         if (!groupSet.member[m.sender]) {
            groupSet.member[m.sender] = {
               lastseen: now,
               warning: 0
            }
         } else {
            groupSet.member[m.sender].lastseen = now
         }
      }
      if (!isOwner && setting.self) return
      if (!m.isGroup && env.blocks.some(no => m.sender.startsWith(no))) return client.updateBlockStatus(m.sender, 'block')
      if (cache.has(m.sender) && cache.get(m.sender) == 'on_hold' && !isOwner) return
      cache.set(m.sender, 'on_hold')
      switch (command) {
         case 'run':
         case 'runtime':
            let _uptime = process.uptime() * 1000
            let uptime = Func.toTime(_uptime)
            client.reply(m.chat, Func.texted('bold', `Running for : [ ${uptime} ]`), m)
            break
         case 'server':
            const json = await Func.fetchJson('http://ip-api.com/json')
            delete json.status
            delete json.query
            let caption = `乂  *S E R V E R*\n\n`
            caption += `┌  ◦  OS : ${os.type()} (${os.arch()} / ${os.release()})\n`
            caption += `│  ◦  Ram : ${Func.formatSize(process.memoryUsage().rss)} / ${Func.formatSize(os.totalmem())}\n`
            for (let key in json) caption += `│  ◦  ${Func.ucword(key)} : ${json[key]}\n`
            caption += `│  ◦  Uptime : ${Func.toTime(os.uptime * 1000)}\n`
            caption += `└  ◦  Processor : ${os.cpus()[0].model}\n\n`
            caption += global.footer
            client.sendMessageModify(m.chat, caption, m, {
               ads: false,
               largeThumb: true,
               thumbnail: setting.cover
            })
            break
         default: {
            const handler = fs.readFileSync('./handler.js', 'utf-8')
            const regex = /(case\s(.*?)[:])/g
            const parse = handler.matchAll(regex)
            let temp = [],
               commands = []
            for (const cmd of parse) {
               temp.push(cmd[2])
            }
            temp.filter(v => v.startsWith(`'`)).map(v => commands.push(v.replace(new RegExp(`'`, 'g'), '')))
            temp.filter(v => v.startsWith(`[`)).map(v => commands.push(Array(v.split `.` [0])))
            const matcher = Func.matcher(command, commands).filter(v => v.accuracy >= 60)
            if (prefix && !commands.includes(command) && matcher.length > 0 && !setting.self) {
               if (!m.isGroup || (m.isGroup && !groupSet.mute)) return client.reply(m.chat, `🚩 Command you are using is wrong, try the following recommendations :\n\n${matcher.map(v => '➠ *' + (prefix ? prefix : '') + v.string + '* (' + v.accuracy + '%)').join('\n')}`, m)
            }
         }
      }
   } catch (e) {
      if (/(undefined|overlimit|timed|timeout|users|item|time)/ig.test(e.message)) return
      console.log(e)
      if (!m.fromMe) return m.reply(Func.jsonFormat(new Error('neoxr-bot encountered an error :' + e)))
   }
   Func.reload(require.resolve(__filename))
}